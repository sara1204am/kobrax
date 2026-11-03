import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { collapseOfficePaths, officeDepth, officeInScope } from '@kobrax/shared';
import { TenantContextService } from '../context/tenant-context.service';
import { officeScopeKindOf, type AssignScope, type OfficeScopeKind } from './office-scope';
import { officeInvalid, officeUnresolved } from './office-scope.errors';

/**
 * El servicio ÚNICO que responde «en qué oficinas trabaja esta persona» y «en qué oficina está este crédito». Ningún
 * consumidor vuelve a hacer `findFirst`/`LIMIT 1` sobre las asignaciones: aunque hoy haya una sola vigente por persona
 * (índice temporal), todo acá ya trabaja con N.
 */
@Injectable()
export class OfficeScopeService {
  constructor(private readonly tenant: TenantContextService) {}

  /** Tipo de alcance del request actual, por capacidad. */
  kind(): OfficeScopeKind {
    return officeScopeKindOf((p) => this.tenant.can(p));
  }

  /** Rutas de las asignaciones vigentes de varias personas (activas en la cuenta). Quien no tiene ninguna va vacía. */
  async assignmentPaths(tx: PrismaClient, userIds: string[]): Promise<Map<string, string[]>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, string[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    // Una sola consulta: asignaciones vigentes de personas que siguen activas en ESTA cuenta.
    const rows = await tx.userBranchAssignment.findMany({
      where: { accountId: this.tenant.accountId, userId: { in: ids }, revokedAt: null, user: { userAccounts: { some: { accountId: this.tenant.accountId, isActive: true } } } },
      select: { userId: true, branch: { select: { path: true } } },
    });
    for (const r of rows) out.get(r.userId)!.push(r.branch.path);
    for (const [id, paths] of out) out.set(id, collapseOfficePaths(paths));
    return out;
  }

  /** Rutas de las asignaciones vigentes de una persona. */
  async pathsOf(tx: PrismaClient, userId: string | undefined): Promise<string[]> {
    if (!userId) return [];
    return (await this.assignmentPaths(tx, [userId])).get(userId) ?? [];
  }

  /** Ruta de la oficina de cada crédito (`null` = sin oficina). Los créditos que no existen no aparecen. */
  async creditOfficePaths(tx: PrismaClient, creditIds: string[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(creditIds)];
    if (ids.length === 0) return new Map();
    const rows = await tx.credit.findMany({
      where: { id: { in: ids }, accountId: this.tenant.accountId, deletedAt: null },
      select: { id: true, branch: { select: { path: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.branch?.path ?? null]));
  }

  /**
   * Hasta dónde reparte quien pide: `data:scope:all` → todo. SUBTREE asignado a la RAÍZ equivale a todo (cubre también lo
   * que no tiene oficina). Cualquier otro con `assignment:write` (supervisor, gerente sin raíz) → las rutas de sus
   * asignaciones; sin asignaciones no puede repartir nada.
   */
  async assignScope(tx: PrismaClient): Promise<AssignScope> {
    const kind = this.kind();
    if (kind === 'ALL') return { kind: 'ALL', paths: [] };
    const paths = await this.pathsOf(tx, this.tenant.userId);
    // La raíz es el único nodo de profundidad 0: su ruta es un solo id. Asignado a ella = cubre todo el árbol.
    if (kind === 'SUBTREE' && paths.some((p) => officeDepth(p) === 0)) return { kind: 'ALL', paths: [] };
    return { kind: 'OFFICES', paths };
  }

  /** ¿Está asignado (vigente) a la raíz de su cuenta, y activo? */
  async assignedToRoot(tx: PrismaClient): Promise<boolean> {
    const userId = this.tenant.userId;
    if (!userId) return false;
    const n = await tx.userBranchAssignment.count({
      where: {
        accountId: this.tenant.accountId,
        userId,
        revokedAt: null,
        branch: { isRoot: true },
        user: { userAccounts: { some: { accountId: this.tenant.accountId, isActive: true } } },
      },
    });
    return n > 0;
  }

  /**
   * Una oficina que el actor PIDIÓ por su id (A-6: el servidor nunca confía en la del cliente): existe en esta cuenta, está
   * activa y cae dentro del alcance de quien la pide (ALL = cualquiera de la cuenta).
   */
  async assertBranchUsable(tx: PrismaClient, branchId: string, scope?: AssignScope): Promise<{ id: string; path: string }> {
    const b = await tx.branch.findFirst({ where: { id: branchId, accountId: this.tenant.accountId, deletedAt: null }, select: { id: true, path: true, active: true } });
    if (!b) throw officeInvalid('NOT_FOUND');
    if (!b.active) throw officeInvalid('INACTIVE');
    if (!this.inScope(scope ?? (await this.assignScope(tx)), b.path)) throw officeInvalid('OUT_OF_SCOPE');
    return { id: b.id, path: b.path };
  }

  /** La oficina de la ÚNICA asignación vigente de una persona, o `null` si no tiene ninguna o tiene varias. */
  async soleOfficeOf(tx: PrismaClient, userId: string): Promise<string | null> {
    const rows = await tx.userBranchAssignment.findMany({
      where: { accountId: this.tenant.accountId, userId, revokedAt: null, user: { userAccounts: { some: { accountId: this.tenant.accountId, isActive: true } } } },
      select: { branchId: true, branch: { select: { active: true, deletedAt: true } } },
    });
    const live = rows.filter((r) => r.branch.active && r.branch.deletedAt === null);
    return live.length === 1 ? live[0]!.branchId : null;
  }

  /** La única oficina HOJA viva de la cuenta (la raíz cuando no hay agencias); `null` si hay varias. */
  async soleLeafOffice(tx: PrismaClient): Promise<string | null> {
    const live = await tx.branch.findMany({ where: { accountId: this.tenant.accountId, deletedAt: null, active: true }, select: { id: true, parentId: true } });
    const parents = new Set(live.map((b) => b.parentId).filter((x): x is string => !!x));
    const leaves = live.filter((b) => !parents.has(b.id));
    return leaves.length === 1 ? leaves[0]!.id : null;
  }

  /**
   * LA OFICINA DE UN CRÉDITO LA DECIDE EL SERVIDOR (A-6 · P0). En este orden, sin NULL en silencio:
   *  1 · `branchId` explícito → existe, es de la cuenta, está activa y dentro del alcance del actor.
   *  2 · si no viene: la oficina de la asignación vigente del responsable (si tiene exactamente una).
   *  3 · si no: la única oficina hoja de la cuenta (la raíz si no hay agencias).
   *  4 · si no se resuelve → 422 CREDIT_BRANCH_UNRESOLVED.
   */
  async resolveCreditBranch(tx: PrismaClient, input: { branchId?: string | null; responsibleId?: string | null }): Promise<string> {
    if (input.branchId) return (await this.assertBranchUsable(tx, input.branchId)).id;
    if (input.responsibleId) {
      const own = await this.soleOfficeOf(tx, input.responsibleId);
      if (own) return own;
    }
    const leaf = await this.soleLeafOffice(tx);
    if (leaf) return leaf;
    throw officeUnresolved();
  }

  /** ¿La oficina (por su ruta) queda dentro del alcance de reparto? */
  inScope(scope: AssignScope, officePath: string | null): boolean {
    if (scope.kind === 'ALL') return true;
    return officePath !== null && officeInScope(officePath, scope.paths);
  }
}
