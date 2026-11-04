import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type Branch, type PrismaClient } from '@prisma/client';
import { MAX_OFFICE_DEPTH, checkOfficeMove, officeInScope, officeDepth, officePath, officePathIds, rebaseOfficePath } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { OfficeScopeService } from '../../common/office-scope/office-scope.service';
import { PlanLimitsService } from '../../common/plan/plan-limits.service';
import { isUniqueViolation } from '../../common/unique-violation';
import { serializeBranch, serializeBranchType, type BranchStats, type BranchWithType } from './branches.serializer';
import { deactivationBlock } from './branch-rules';
import type { BranchDetailView, BranchTypeView, BranchView } from './branches.dto';
import {
  AssignMembersDto,
  CreateBranchDto,
  CreateBranchTypeDto,
  MoveBranchDto,
  UpdateBranchDto,
  UpdateBranchTypeDto,
} from './dto/branch.dto';
import {
  branchAssignmentExists,
  branchCodeDuplicate,
  branchHasChildren,
  branchHasCredits,
  branchHasMembers,
  branchInactive,
  branchLocationIncomplete,
  branchManagerInvalid,
  branchMemberNotFound,
  branchMembersInvalid,
  branchMoveInvalid,
  branchNotFound,
  branchParentInactive,
  branchParentInvalid,
  branchRootProtected,
  branchTooDeep,
  branchTypeCodeDuplicate,
  branchTypeInvalid,
  branchTypeNotFound,
} from './branches.errors';

/** El punto del mapa: las dos coordenadas juntas (número = poner, `null` = quitar) o ninguna (no se toca). */
const locationData = (dto: { latitude?: number | null; longitude?: number | null }): { latitude?: number | null; longitude?: number | null } => {
  if (dto.latitude === undefined && dto.longitude === undefined) return {};
  const bothNull = dto.latitude === null && dto.longitude === null;
  const bothNumber = typeof dto.latitude === 'number' && typeof dto.longitude === 'number';
  if (!bothNull && !bothNumber) throw branchLocationIncomplete();
  return { latitude: dto.latitude, longitude: dto.longitude };
};

const normalizeCode = (code: string | null | undefined): string | null | undefined =>
  code === undefined || code === null ? code : code.toUpperCase();

/** Tipo por defecto de una oficina nueva sin `typeId` (el catálogo base de cada cuenta lo trae). */
const DEFAULT_TYPE_CODE = 'AGENCIA';

interface LockedNode {
  id: string;
  path: string;
  depth: number;
  active: boolean;
  is_root: boolean;
}

/**
 * Oficinas de la cuenta (F13): un ÁRBOL por cuenta (ADR-0003), con una raíz que representa a la empresa (ADR-0004).
 *
 * 🔴 **Toda mutación de la estructura (alta, mover, baja, alta de nuevo) toma primero el bloqueo de la raíz de la cuenta**
 * (`SELECT … FOR UPDATE`) y después el del padre o el nodo: así dos altas simultáneas no pasan el tope del plan a la vez ni
 * dos movimientos cruzados arman un ciclo. Siempre en ese orden (raíz → padre → subárbol) para no cruzar bloqueos.
 *
 * `branches.path` es la ruta materializada: la escribe SÓLO este servicio, dentro de la transacción que bloquea.
 * Cambiar la oficina de una persona **cambia lo que ve**: cada asignación se audita.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly plan: PlanLimitsService,
    private readonly office: OfficeScopeService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  // ── Lectura ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Personas asignadas, créditos, hijas y nombre del responsable de cada oficina, en pocas consultas (no una por oficina). */
  private async statsFor(tx: PrismaClient, branches: Branch[]): Promise<Map<string, BranchStats>> {
    const ids = branches.map((b) => b.id);
    const managerIds = branches.map((b) => b.managerUserId).filter((x): x is string => !!x);
    const accountId = this.tenant.accountId;
    const [members, credits, children, managers] = await Promise.all([
      ids.length
        ? tx.userBranchAssignment.groupBy({
            by: ['branchId'],
            where: { branchId: { in: ids }, revokedAt: null, user: { userAccounts: { some: { accountId, isActive: true } } } },
            _count: { _all: true },
          })
        : [],
      ids.length ? tx.credit.groupBy({ by: ['branchId'], where: { branchId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [],
      ids.length ? tx.branch.groupBy({ by: ['parentId'], where: { parentId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [],
      managerIds.length ? tx.profile.findMany({ where: { userId: { in: managerIds } }, select: { userId: true, firstName: true, lastName: true } }) : [],
    ]);
    const memberCount = new Map(members.map((m) => [m.branchId, m._count._all]));
    const creditCount = new Map(credits.map((c) => [c.branchId, c._count._all]));
    const childCount = new Map(children.map((c) => [c.parentId, c._count._all]));
    const nameOf = new Map(managers.map((p) => [p.userId, `${p.firstName} ${p.lastName}`.trim()]));
    return new Map(
      branches.map((b) => [
        b.id,
        {
          members: memberCount.get(b.id) ?? 0,
          credits: creditCount.get(b.id) ?? 0,
          children: childCount.get(b.id) ?? 0,
          managerName: b.managerUserId ? (nameOf.get(b.managerUserId) ?? null) : null,
        },
      ]),
    );
  }

  /**
   * Hasta dónde ve quien lee oficinas: el alcance total (o el gerente asignado a la raíz) ve el árbol entero; el resto, sólo las
   * oficinas de SUS asignaciones y lo que cuelga de ellas (D-7). Sin asignaciones no ve ninguna (falla cerrado).
   * `null` = sin restricción.
   */
  private async visiblePaths(tx: PrismaClient): Promise<string[] | null> {
    const scope = await this.office.assignScope(tx);
    return scope.kind === 'ALL' ? null : scope.paths;
  }

  /**
   * Lista plana del árbol (la web arma el árbol con `parentId`/`path`). La ruta completa de cada oficina se calcula con TODOS sus
   * ancestros aunque quien lee no los vea como filas: «Chuquisaca › Agencia Central» sigue siendo legible para un supervisor.
   */
  async list(): Promise<BranchView[]> {
    return this.tx(async (tx) => {
      const rows = await tx.branch.findMany({
        where: { deletedAt: null },
        include: { type: { select: { id: true, code: true, name: true } } },
        orderBy: [{ depth: 'asc' }, { active: 'desc' }, { name: 'asc' }],
      });
      const paths = await this.visiblePaths(tx);
      const visible = paths === null ? rows : rows.filter((b) => officeInScope(b.path, paths));
      const stats = await this.statsFor(tx, visible);
      return visible.map((b) => serializeBranch(b, stats.get(b.id)!, rows));
    });
  }

  /** Una oficina serializada, con la ruta completa tomada de sus ancestros. */
  private async one(tx: PrismaClient, id: string) {
    const row = await tx.branch.findFirst({ where: { id, deletedAt: null }, include: { type: { select: { id: true, code: true, name: true } } } });
    if (!row) throw branchNotFound();
    const [stats, ancestors] = await Promise.all([
      this.statsFor(tx, [row]),
      tx.branch.findMany({ where: { id: { in: officePathIds(row.path) } }, select: { id: true, name: true, path: true } }),
    ]);
    return serializeBranch(row as BranchWithType, stats.get(row.id)!, ancestors);
  }

  /** Detalle: la oficina, quién trabaja en ella y su historial (auditoría de la entidad). */
  async detail(id: string): Promise<BranchDetailView> {
    return this.tx(async (tx) => {
      const branch = await this.one(tx, id);
      const paths = await this.visiblePaths(tx);
      if (paths !== null && !officeInScope(branch.path, paths)) throw branchNotFound();
      const accountId = this.tenant.accountId;
      const assignments = await tx.userBranchAssignment.findMany({
        where: { branchId: id, revokedAt: null, user: { userAccounts: { some: { accountId, isActive: true } } } },
        select: { userId: true, isPrimary: true, createdAt: true, user: { select: { profile: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'asc' },
      });
      const roles = assignments.length
        ? await tx.userAccount.findMany({ where: { accountId, userId: { in: assignments.map((a) => a.userId) } }, select: { userId: true, role: { select: { name: true } } } })
        : [];
      const roleOf = new Map(roles.map((r) => [r.userId, r.role.name]));
      const logs = await tx.auditLog.findMany({
        where: { entity: 'branch', entityId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, action: true, userId: true, before: true, after: true, createdAt: true },
      });
      const actors = logs.length
        ? await tx.profile.findMany({ where: { userId: { in: [...new Set(logs.map((l) => l.userId))] } }, select: { userId: true, firstName: true, lastName: true } })
        : [];
      const actorName = new Map(actors.map((p) => [p.userId, `${p.firstName} ${p.lastName}`.trim()]));
      return {
        ...branch,
        stats: { members: branch.members, credits: branch.credits, children: branch.children },
        // Sin correo ni teléfono: quien lee oficinas (`office:read`) no es necesariamente quien lee usuarios.
        membersList: assignments.map((a) => ({
          userId: a.userId,
          name: `${a.user.profile?.firstName ?? ''} ${a.user.profile?.lastName ?? ''}`.trim() || null,
          roleName: roleOf.get(a.userId) ?? null,
          isPrimary: a.isPrimary,
          since: a.createdAt.toISOString(),
        })),
        history: logs.map((l) => ({
          id: l.id,
          action: l.action,
          at: l.createdAt.toISOString(),
          actorId: l.userId,
          actorName: actorName.get(l.userId) ?? null,
          before: l.before,
          after: l.after,
        })),
      };
    });
  }

  // ── Validaciones ──────────────────────────────────────────────────────────────────────────────────────────────

  /** El responsable es una persona activa de **esta** cuenta (la RLS ya acota `user_accounts` al tenant). */
  private async assertManager(tx: PrismaClient, userId: string): Promise<void> {
    const member = await tx.userAccount.findFirst({ where: { userId, isActive: true }, select: { id: true } });
    if (!member) throw branchManagerInvalid();
  }

  /** El código es único entre las oficinas vivas. La base lo garantiza; esto da el 409 en vez de un 500. */
  private async assertCodeFree(tx: PrismaClient, code: string, exceptId?: string): Promise<void> {
    const clash = await tx.branch.findFirst({
      where: { code, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw branchCodeDuplicate(code);
  }

  /** El tipo existe en la cuenta y está activo; sin `typeId`, el tipo por defecto (AGENCIA). */
  private async resolveType(tx: PrismaClient, typeId?: string): Promise<string> {
    const type = typeId
      ? await tx.branchType.findFirst({ where: { id: typeId, accountId: this.tenant.accountId, isActive: true }, select: { id: true } })
      : await tx.branchType.findFirst({ where: { code: DEFAULT_TYPE_CODE, accountId: this.tenant.accountId, isActive: true }, select: { id: true } });
    if (!type) throw branchTypeInvalid();
    return type.id;
  }

  /** Bloquea la raíz de la cuenta: serializa las mutaciones de estructura (ver la nota de la clase). */
  private async lockStructure(tx: PrismaClient): Promise<{ id: string } | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM branches WHERE account_id = ${this.tenant.accountId} AND is_root = true AND deleted_at IS NULL FOR UPDATE`,
    );
    return rows[0] ?? null;
  }

  /** Lee y bloquea un nodo vivo de ESTA cuenta (`null` si no existe o es de otra). */
  private async lockNode(tx: PrismaClient, id: string): Promise<LockedNode | null> {
    const rows = await tx.$queryRaw<LockedNode[]>(
      Prisma.sql`SELECT id, path, depth, active, is_root FROM branches WHERE id = ${id} AND account_id = ${this.tenant.accountId} AND deleted_at IS NULL FOR UPDATE`,
    );
    return rows[0] ?? null;
  }

  /** Por qué no se puede dar de baja (hijas activas, créditos, personas vigentes). La raíz nunca. */
  private async assertCanLeave(tx: PrismaClient, node: Pick<Branch, 'id' | 'isRoot'>): Promise<void> {
    const accountId = this.tenant.accountId;
    const [children, credits, members] = await Promise.all([
      tx.branch.count({ where: { parentId: node.id, deletedAt: null, active: true } }),
      tx.credit.count({ where: { branchId: node.id, deletedAt: null } }),
      tx.userBranchAssignment.count({ where: { branchId: node.id, revokedAt: null, user: { userAccounts: { some: { accountId, isActive: true } } } } }),
    ]);
    const block = deactivationBlock({ isRoot: node.isRoot, children, credits, members });
    if (block === 'ROOT') throw branchRootProtected();
    if (block === 'CHILDREN') throw branchHasChildren(children);
    if (block === 'CREDITS') throw branchHasCredits(credits);
    if (block === 'MEMBERS') throw branchHasMembers(members);
  }

  // ── Oficinas ──────────────────────────────────────────────────────────────────────────────────────────────────

  async create(dto: CreateBranchDto) {
    const code = normalizeCode(dto.code) ?? null;
    const id = randomUUID();
    const created = await this.tx(async (tx) => {
      const root = await this.lockStructure(tx);
      if (!root) throw branchParentInvalid(); // una cuenta sin raíz no debería existir; se frena en vez de crear huérfanos
      const parent = await this.lockNode(tx, dto.parentId ?? root.id);
      if (!parent) throw branchParentInvalid();
      if (!parent.active) throw branchParentInactive();
      if (parent.depth + 1 > MAX_OFFICE_DEPTH) throw branchTooDeep(MAX_OFFICE_DEPTH);
      // El tope va DENTRO de la transacción que escribe y tras el bloqueo: dos altas simultáneas no pasan juntas.
      await this.plan.assertRoom('branches', tx);
      if (code) await this.assertCodeFree(tx, code);
      if (dto.managerUserId) await this.assertManager(tx, dto.managerUserId);
      const typeId = await this.resolveType(tx, dto.typeId);
      return tx.branch.create({
        data: {
          id,
          accountId: this.tenant.accountId,
          name: dto.name.trim(),
          code,
          city: dto.city ?? null,
          address: dto.address ?? null,
          ...locationData(dto),
          managerUserId: dto.managerUserId ?? null,
          parentId: parent.id,
          typeId,
          path: officePath(parent.path, id),
          depth: parent.depth + 1,
          isRoot: false,
        },
      });
    });
    await this.audit.record({ entity: 'branch', entityId: created.id, action: 'CREATE', after: created });
    return this.tx((tx) => this.one(tx, created.id));
  }

  async update(id: string, dto: UpdateBranchDto) {
    const { before, updated } = await this.tx(async (tx) => {
      await this.lockStructure(tx);
      const before = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw branchNotFound();

      const code = normalizeCode(dto.code);
      if (code) await this.assertCodeFree(tx, code, id);
      if (dto.managerUserId) await this.assertManager(tx, dto.managerUserId);
      if (dto.active === false && before.active) await this.assertCanLeave(tx, before);
      if (dto.active === true && !before.active) await this.assertParentActive(tx, before);
      const typeId = dto.typeId ? await this.resolveType(tx, dto.typeId) : undefined;

      const updated = await tx.branch.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          code,
          city: dto.city,
          address: dto.address,
          ...locationData(dto),
          managerUserId: dto.managerUserId,
          active: dto.active,
          typeId,
        },
      });
      return { before, updated };
    });
    await this.audit.record({ entity: 'branch', entityId: id, action: 'UPDATE', before, after: updated });
    return this.tx((tx) => this.one(tx, id));
  }

  /** Reactivar bajo un padre apagado dejaría una oficina viva colgando de una muerta. */
  private async assertParentActive(tx: PrismaClient, node: Pick<Branch, 'parentId'>): Promise<void> {
    if (!node.parentId) return;
    const parent = await tx.branch.findFirst({ where: { id: node.parentId, deletedAt: null }, select: { active: true } });
    if (!parent || !parent.active) throw branchParentInactive();
  }

  /**
   * Cambia la oficina de lugar en el árbol. Sin ciclos, la raíz no se mueve, no pasa la profundidad máxima. Reescribe el `path`
   * y la `depth` de TODO el subárbol en una sola transacción, con las filas bloqueadas.
   */
  async move(id: string, dto: MoveBranchDto) {
    const result = await this.tx(async (tx) => {
      await this.lockStructure(tx);
      const node = await this.lockNode(tx, id);
      if (!node) throw branchNotFound();
      const nodeRow = await tx.branch.findFirstOrThrow({ where: { id }, select: { id: true, parentId: true, isRoot: true, path: true, depth: true } });
      const parent = await this.lockNode(tx, dto.parentId);
      if (!parent) throw branchParentInvalid();

      // El subárbol bloqueado entero: sus filas no pueden cambiar mientras se reescriben.
      const subtree = await tx.$queryRaw<{ id: string; path: string; depth: number }[]>(
        Prisma.sql`SELECT id, path, depth FROM branches WHERE account_id = ${this.tenant.accountId} AND deleted_at IS NULL AND path LIKE ${node.path + '%'} FOR UPDATE`,
      );
      const height = subtree.reduce((m, n) => Math.max(m, n.depth - node.depth), 0);
      const check = checkOfficeMove(nodeRow, parent, height, MAX_OFFICE_DEPTH);
      if (check === 'SAME_PARENT') return { moved: false as const };
      if (check !== 'OK') throw branchMoveInvalid(check, MAX_OFFICE_DEPTH);
      if (!parent.active) throw branchParentInactive();

      const toPrefix = officePath(parent.path, id);
      for (const n of subtree) {
        const path = rebaseOfficePath(n.path, node.path, toPrefix);
        await tx.branch.update({ where: { id: n.id }, data: { path, depth: officeDepth(path), ...(n.id === id ? { parentId: parent.id } : {}) } });
      }
      return {
        moved: true as const,
        before: { parentId: nodeRow.parentId, path: node.path, depth: node.depth },
        after: { parentId: parent.id, path: toPrefix, depth: parent.depth + 1, subtreeSize: subtree.length },
      };
    });
    if (result.moved) await this.audit.record({ entity: 'branch', entityId: id, action: 'MOVE', before: result.before, after: result.after });
    return this.tx((tx) => this.one(tx, id));
  }

  /** Se apaga (no se borra): vuelve con `restore`. Bloqueada si tiene hijas activas, créditos o personas vigentes. */
  async deactivate(id: string) {
    const changed = await this.tx(async (tx) => {
      await this.lockStructure(tx);
      const before = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw branchNotFound();
      if (!before.active) return false; // idempotente
      await this.assertCanLeave(tx, before);
      await tx.branch.update({ where: { id }, data: { active: false } });
      return true;
    });
    if (changed) await this.audit.record({ entity: 'branch', entityId: id, action: 'DEACTIVATE', before: { active: true }, after: { active: false } });
    return this.tx((tx) => this.one(tx, id));
  }

  async restore(id: string) {
    const changed = await this.tx(async (tx) => {
      await this.lockStructure(tx);
      const before = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw branchNotFound();
      if (before.active) return false; // idempotente
      await this.assertParentActive(tx, before);
      await tx.branch.update({ where: { id }, data: { active: true } });
      return true;
    });
    if (changed) await this.audit.record({ entity: 'branch', entityId: id, action: 'RESTORE', before: { active: false }, after: { active: true } });
    return this.tx((tx) => this.one(tx, id));
  }

  /** Baja lógica (libera el código y el lugar del plan). Mismas condiciones que desactivar, y sin hijas vivas de ningún tipo. */
  async remove(id: string): Promise<void> {
    const removed = await this.tx(async (tx) => {
      await this.lockStructure(tx);
      const found = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!found) throw branchNotFound();
      await this.assertCanLeave(tx, found);
      const anyChild = await tx.branch.count({ where: { parentId: id, deletedAt: null } });
      if (anyChild > 0) throw branchHasChildren(anyChild);
      // Las asignaciones vigentes de esta oficina (también las de usuarios inactivos, que no frenan la baja) quedan revocadas, y
      // el espejo legado limpio: no puede quedar una persona apuntando a una oficina borrada.
      await tx.userBranchAssignment.updateMany({ where: { branchId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.userAccount.updateMany({ where: { accountId: this.tenant.accountId, branchId: id }, data: { branchId: null } });
      return tx.branch.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    });
    await this.audit.record({ entity: 'branch', entityId: id, action: 'DELETE', before: removed });
  }

  // ── Personas en la oficina ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Asigna varias personas a esta oficina en una sola transacción. Escribe la asignación (`user_branch_assignments`, la fuente
   * del alcance) y el espejo legado `user_accounts.branch_id`, que sigue vivo durante la transición.
   *
   * Por defecto MUEVE: si la persona estaba en otra oficina, se revoca esa asignación. Hay UNA vigente por persona y cuenta
   * (índice temporal): con `mode: 'ADD'` se pide una adicional y se responde 409 si ya tiene otra.
   */
  async assignMembers(id: string, dto: AssignMembersDto) {
    const actor = this.tenant.userId ?? null;
    const userIds = [...new Set([...(dto.userIds ?? []), ...(dto.userId ? [dto.userId] : [])])];
    if (userIds.length === 0) throw branchMembersInvalid();
    const moved = await this.tx(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id, deletedAt: null } });
      if (!branch) throw branchNotFound();
      if (!branch.active) throw branchInactive();

      const accountId = this.tenant.accountId;
      const members = await tx.userAccount.findMany({
        where: { accountId, userId: { in: userIds }, isActive: true },
        select: { id: true, userId: true, branchId: true },
      });
      if (members.length !== userIds.length) throw branchMembersInvalid();

      const current = await tx.userBranchAssignment.findMany({ where: { accountId, userId: { in: userIds }, revokedAt: null }, select: { id: true, userId: true, branchId: true } });
      const here = new Set(current.filter((a) => a.branchId === id).map((a) => a.userId));
      const elsewhere = current.filter((a) => a.branchId !== id);
      if ((dto.mode ?? 'MOVE') === 'ADD') {
        const clash = elsewhere[0];
        if (clash) throw branchAssignmentExists(clash.userId, clash.branchId);
      }
      if (elsewhere.length > 0) {
        await tx.userBranchAssignment.updateMany({ where: { id: { in: elsewhere.map((a) => a.id) } }, data: { revokedAt: new Date() } });
      }
      const toCreate = members.filter((m) => !here.has(m.userId));
      try {
        if (toCreate.length > 0) {
          await tx.userBranchAssignment.createMany({
            data: toCreate.map((m) => ({ accountId, userId: m.userId, branchId: id, isPrimary: true, createdBy: actor })),
          });
        }
      } catch (e) {
        if (isUniqueViolation(e)) throw branchAssignmentExists(toCreate[0]?.userId ?? '', null);
        throw e;
      }
      await tx.userAccount.updateMany({ where: { id: { in: members.map((m) => m.id) } }, data: { branchId: id } });

      const previous = new Map(elsewhere.map((a) => [a.userId, a.branchId]));
      return toCreate.map((m) => ({ ...m, from: previous.get(m.userId) ?? m.branchId ?? null }));
    });
    for (const m of moved) {
      await this.audit.record({
        entity: 'user_account',
        entityId: m.id,
        action: 'UPDATE',
        before: { branchId: m.from },
        after: { branchId: id },
      });
    }
    return this.tx((tx) => this.one(tx, id));
  }

  /** Quita a la persona de esta oficina: revoca su asignación vigente y limpia el espejo legado. */
  async unassignMember(id: string, userId: string) {
    const removed = await this.tx(async (tx) => {
      const accountId = this.tenant.accountId;
      const branch = await tx.branch.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!branch) throw branchNotFound();
      const assignment = await tx.userBranchAssignment.findFirst({ where: { accountId, userId, branchId: id, revokedAt: null }, select: { id: true } });
      if (!assignment) throw branchMemberNotFound();
      await tx.userBranchAssignment.update({ where: { id: assignment.id }, data: { revokedAt: new Date() } });
      await tx.userAccount.updateMany({ where: { accountId, userId, branchId: id }, data: { branchId: null } });
      return assignment.id;
    });
    await this.audit.record({
      entity: 'user_branch_assignment',
      entityId: removed,
      action: 'REVOKE',
      before: { userId, branchId: id },
      after: { userId, branchId: null },
    });
    return this.tx((tx) => this.one(tx, id));
  }

  // ── Tipos de oficina (catálogo por cuenta · R1) ───────────────────────────────────────────────────────────────

  async listTypes(): Promise<BranchTypeView[]> {
    return this.tx(async (tx) => {
      const rows = await tx.branchType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
      return rows.map(serializeBranchType);
    });
  }

  async createType(dto: CreateBranchTypeDto) {
    const created = await this.tx(async (tx) => {
      const clash = await tx.branchType.findFirst({ where: { code: dto.code, accountId: this.tenant.accountId }, select: { id: true } });
      if (clash) throw branchTypeCodeDuplicate(dto.code);
      try {
        return await tx.branchType.create({ data: { accountId: this.tenant.accountId, code: dto.code, name: dto.name.trim(), sortOrder: dto.sortOrder ?? 0 } });
      } catch (e) {
        if (isUniqueViolation(e)) throw branchTypeCodeDuplicate(dto.code);
        throw e;
      }
    });
    await this.audit.record({ entity: 'branch_type', entityId: created.id, action: 'CREATE', after: created });
    return serializeBranchType(created);
  }

  async updateType(id: string, dto: UpdateBranchTypeDto) {
    const { before, updated } = await this.tx(async (tx) => {
      const before = await tx.branchType.findFirst({ where: { id, accountId: this.tenant.accountId } });
      if (!before) throw branchTypeNotFound();
      const updated = await tx.branchType.update({ where: { id }, data: { name: dto.name?.trim(), sortOrder: dto.sortOrder, isActive: dto.isActive } });
      return { before, updated };
    });
    await this.audit.record({ entity: 'branch_type', entityId: id, action: 'UPDATE', before, after: updated });
    return serializeBranchType(updated);
  }
}
