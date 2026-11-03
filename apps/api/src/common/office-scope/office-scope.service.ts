import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { collapseOfficePaths, officeDepth, officeInScope } from '@kobrax/shared';
import { TenantContextService } from '../context/tenant-context.service';
import { officeScopeKindOf, type AssignScope, type OfficeScopeKind } from './office-scope';

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

  /** ¿La oficina (por su ruta) queda dentro del alcance de reparto? */
  inScope(scope: AssignScope, officePath: string | null): boolean {
    if (scope.kind === 'ALL') return true;
    return officePath !== null && officeInScope(officePath, scope.paths);
  }
}
