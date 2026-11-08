import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  MOBILE_ROLES,
  ROLE_REASON_MIN_LENGTH,
  diffPermissions,
  type PermissionCatalogEntry,
  type PermissionReserved,
  type PermissionRisk,
  type RoleCompare,
  type RoleDetail,
  type RoleHistoryEntry,
  type RoleHistoryPage,
  type RoleSummary,
  type RoleUpdateResult,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { PolicyService } from '../../common/authz/policy.service';
import { isReservedRole, tierOf } from '../../common/authz/tier';
import { AuthzVersionService } from '../auth/authz-version.service';
import { invalidCursor, noTemplate, reasonRequired, roleNotFound, versionConflict } from './roles.errors';
import { compareGranted, serializeAssignableRole, summarizeRole, type AccountRoleRow } from './roles.serializer';

const ENTITY = 'account_role';

/**
 * Los roles de la cuenta (F14 · F7). UN solo recurso para quien invita o cambia el rol de una persona (web y móvil: `assignable`) y para el
 * administrador que consulta y edita permisos. Las reglas de nivel y de lo reservado viven una sola vez (`common/authz`), y las de edición en la
 * política `role.editPermissions` (que usan las funciones puras de `@kobrax/shared`, las mismas que avisan en la web).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly policies: PolicyService,
    private readonly authz: AuthzVersionService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private get actorId(): string {
    const id = this.tenant.userId;
    if (!id) throw new Error('RolesService requiere un request autenticado');
    return id;
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  /**
   * Los roles que quien pregunta puede OFRECER al invitar o cambiar un rol (F14 · F2, H-3/H-13): de `tier` estrictamente inferior al suyo y ninguno
   * reservado. El servidor lo vuelve a exigir en `member.invite`/`member.assignRole`. Es el contrato histórico de `GET /roles` (no cambia).
   */
  async assignable(): Promise<{ id: string; name: string; level: number }[]> {
    const { roles, mine } = await this.tx(async (tx) => ({
      roles: await tx.role.findMany({ where: { name: { in: [...MOBILE_ROLES] } }, orderBy: { level: 'desc' } }),
      mine: await tx.userAccount.findFirst({ where: { userId: this.actorId, accountId: this.tenant.accountId }, select: { role: { select: { name: true, level: true } } } }),
    }));
    const myTier = mine ? tierOf(mine.role) : -1;
    return roles.filter((r) => !isReservedRole(r) && tierOf(r) < myTier).map(serializeAssignableRole);
  }

  /** Todos los roles de la cuenta, con su detalle (vista del administrador). */
  async listAll(): Promise<RoleSummary[]> {
    return this.tx(async (tx) => {
      const [rows, total, counts, globals] = await Promise.all([this.loadRows(tx), this.catalogSize(tx), this.memberCounts(tx), tx.role.findMany({ select: { id: true, name: true } })]);
      const roleIdByName = new Map(globals.map((g) => [g.name, g.id]));
      return rows.map((r) => summarizeRole(r, { roleIdByName, members: counts.get(r.id) ?? 0, permissionsTotal: total }));
    });
  }

  /** El catálogo de permisos que el editor muestra, ordenado por módulo y código. */
  async catalog(): Promise<PermissionCatalogEntry[]> {
    return this.tx(async (tx) => {
      const rows = await tx.permission.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
      return rows.map((p) => ({
        code: p.code,
        module: p.code.split(':')[0] ?? p.module,
        action: p.action,
        risk: p.risk as PermissionRisk,
        reserved: (p.reserved as PermissionReserved | null) ?? null,
        requires: Array.isArray(p.requires) ? (p.requires as string[]) : [],
        name: p.name,
        description: p.description,
      }));
    });
  }

  async detail(key: string): Promise<RoleDetail> {
    return this.tx((tx) => this.detailIn(tx, key));
  }

  async compare(a: string, b: string): Promise<RoleCompare> {
    return this.tx(async (tx) => {
      const [da, db] = await Promise.all([this.detailIn(tx, a), this.detailIn(tx, b)]);
      const { people: _pa, diff: _da, granted: ga, templateKey: _ta, ...sa } = da;
      const { people: _pb, diff: _db, granted: gb, templateKey: _tb, ...sb } = db;
      void [_pa, _da, _ta, _pb, _db, _tb];
      return { a: sa, b: sb, rows: compareGranted(ga, gb) };
    });
  }

  /** Historial de un rol desde la auditoría, de lo más nuevo a lo más viejo. El cursor es `<fecha ISO>|<id>`. */
  async history(key: string, cursor?: string, limit = 30): Promise<RoleHistoryPage> {
    return this.tx(async (tx) => {
      const role = await tx.accountRole.findFirst({ where: { accountId: this.tenant.accountId, key, deletedAt: null }, select: { id: true } });
      if (!role) throw roleNotFound();
      const [at, id] = (cursor ?? '').split('|');
      // Un cursor mal formado NO se ignora: devolvería la primera página otra vez y la lista se duplicaría.
      if (cursor && (!at || !id || Number.isNaN(new Date(at).getTime()))) throw invalidCursor();
      const before = cursor ? { at: new Date(at!), id: id! } : null;
      const rows = await tx.auditLog.findMany({
        where: {
          accountId: this.tenant.accountId,
          entity: ENTITY,
          entityId: role.id,
          ...(before ? { OR: [{ createdAt: { lt: before.at } }, { createdAt: before.at, id: { lt: before.id } }] } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const userIds = [...new Set(page.map((r) => r.userId).filter((u): u is string => Boolean(u)))];
      const people = userIds.length
        ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } })
        : [];
      const nameOf = new Map(people.map((p) => [p.id, [p.profile?.firstName, p.profile?.lastName].filter(Boolean).join(' ') || p.email]));
      const items: RoleHistoryEntry[] = page.map((r) => {
        const after = (r.after ?? {}) as { added?: string[]; removed?: string[]; reason?: string };
        return {
          id: r.id,
          at: r.createdAt.toISOString(),
          actorType: r.actorType === 'PLATFORM' ? 'PLATFORM' : 'USER',
          actorName: r.userId ? (nameOf.get(r.userId) ?? null) : null,
          action: r.action,
          added: after.added ?? [],
          removed: after.removed ?? [],
          reason: after.reason ?? null,
        };
      });
      const last = page[page.length - 1];
      return { items, nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null };
    });
  }

  // ── Escritura ──────────────────────────────────────────────────────────────

  /** Reemplaza el conjunto de permisos de un rol (con motivo y versión esperada). */
  updatePermissions(key: string, input: { permissions: string[]; expectedVersion: number; reason: string }): Promise<RoleUpdateResult> {
    return this.change(key, input.expectedVersion, input.reason, 'ROLE_PERMISSIONS_UPDATED', () => [...new Set(input.permissions)]);
  }

  /** Devuelve el rol a los permisos de su plantilla. */
  restoreTemplate(key: string, input: { expectedVersion: number; reason: string }): Promise<RoleUpdateResult> {
    return this.change(key, input.expectedVersion, input.reason, 'ROLE_RESTORED_TEMPLATE', (templateCodes) => {
      if (!templateCodes) throw noTemplate();
      return templateCodes;
    });
  }

  /**
   * El cambio de permisos de un rol, TODO en una transacción (D-5): bloqueo de la fila del rol, política de edición, versión esperada, permisos,
   * `version`/`diverged_at`, renovación de `authz_version` de sus miembros y fila de auditoría. La publicación a Redis va después del commit.
   */
  private async change(
    key: string,
    expectedVersion: number,
    reason: string,
    action: 'ROLE_PERMISSIONS_UPDATED' | 'ROLE_RESTORED_TEMPLATE',
    /** Los permisos que el rol tendrá; recibe los de su plantilla (`null` si no tiene) para no pedirlos dos veces. */
    desiredOf: (templateCodes: string[] | null) => string[],
  ): Promise<RoleUpdateResult> {
    const motive = (reason ?? '').trim();
    if (motive.length < ROLE_REASON_MIN_LENGTH) throw reasonRequired();
    const accountId = this.tenant.accountId;
    const isPlatform = this.tenant.get()?.actorType === 'PLATFORM';

    let pending: Awaited<ReturnType<AuthzVersionService['bumpInTx']>> = [];
    const result = await this.tx(async (tx) => {
      const found = await tx.accountRole.findFirst({ where: { accountId, key, deletedAt: null }, select: { id: true } });
      if (!found) throw roleNotFound();
      // Bloqueo de la fila: dos administradores que guardan a la vez se serializan y el segundo ve la versión nueva.
      await tx.$queryRaw`SELECT id FROM account_roles WHERE id = ${found.id} FOR UPDATE`;
      // Se lee DESPUÉS del bloqueo: es la foto que vale.
      const role = await tx.accountRole.findFirstOrThrow({ where: { id: found.id }, select: { id: true, templateKey: true, version: true, divergedAt: true } });
      // La versión se compara ANTES de juzgar el contenido: quien tiene una foto vieja debe recibir el 409 (y la opción de recargar),
      // no un 403/422 sobre un conjunto que ya no es el que está en la base.
      if (role.version !== expectedVersion) throw versionConflict(role.version);

      const templateCodes = role.templateKey ? await this.templateCodes(tx, role.templateKey) : null;
      const desired = desiredOf(templateCodes);
      const decision = (await this.policies.assert('role.editPermissions', { key, permissions: desired }, tx)) as { current: string[] };

      const { added, removed } = diffPermissions(decision.current, desired);
      if (added.length === 0 && removed.length === 0) return { detail: await this.detailIn(tx, key), affected: 0 };

      const codes = [...added, ...removed];
      const perms = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
      const idOf = new Map(perms.map((p) => [p.code, p.id]));
      const templateSet = new Set(templateCodes ?? []);

      if (removed.length) {
        await tx.accountRolePermission.deleteMany({ where: { accountRoleId: role.id, permissionId: { in: removed.map((c) => idOf.get(c)!) } } });
      }
      if (added.length) {
        await tx.accountRolePermission.createMany({
          data: added.map((c) => ({
            accountRoleId: role.id,
            permissionId: idOf.get(c)!,
            accountId,
            // Lo que la plantilla ya traía vuelve a ser «de plantilla»; lo demás es personalizado.
            source: templateSet.has(c) ? ('TEMPLATE' as const) : ('CUSTOM' as const),
            grantedBy: isPlatform ? null : this.actorId,
          })),
        });
      }

      const diverges = role.templateKey ? (() => { const d = diffPermissions([...templateSet], desired); return d.added.length > 0 || d.removed.length > 0; })() : false;
      await tx.accountRole.update({ where: { id: role.id }, data: { version: { increment: 1 }, divergedAt: diverges ? (role.divergedAt ?? new Date()) : null } });

      const members = await tx.userAccount.findMany({ where: { accountId, accountRoleId: role.id, isActive: true }, select: { id: true } });
      pending = await this.authz.bumpInTx(tx, accountId, members.map((m) => m.id));

      await this.audit.recordInTx(tx, { entity: ENTITY, entityId: role.id, action, after: { key, added, removed, reason: motive } });
      return { detail: await this.detailIn(tx, key), affected: members.length };
    });

    // Tras el commit: las sesiones de esas personas se renuevan en su próxima petición.
    await this.authz.publish(pending);
    return { role: result.detail, affectedMembers: result.affected };
  }

  // ── Lecturas internas ──────────────────────────────────────────────────────

  private async templateCodes(tx: PrismaClient, templateKey: string): Promise<string[]> {
    const rows = await tx.roleTemplatePermission.findMany({ where: { templateKey }, select: { permission: { select: { code: true } } } });
    return rows.map((r) => r.permission.code).sort();
  }

  private async catalogSize(tx: PrismaClient): Promise<number> {
    return tx.permission.count({ where: { active: true } });
  }

  private async memberCounts(tx: PrismaClient): Promise<Map<string, number>> {
    const rows = await tx.userAccount.groupBy({ by: ['accountRoleId'], where: { accountId: this.tenant.accountId, isActive: true, accountRoleId: { not: null } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.accountRoleId!, r._count._all]));
  }

  private async loadRows(tx: PrismaClient, key?: string): Promise<AccountRoleRow[]> {
    const rows = await tx.accountRole.findMany({
      where: { accountId: this.tenant.accountId, deletedAt: null, ...(key ? { key } : {}) },
      orderBy: [{ tier: 'desc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        tier: true,
        templateKey: true,
        version: true,
        divergedAt: true,
        updatedAt: true,
        permissions: { select: { permission: { select: { code: true } } } },
        template: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      tier: r.tier,
      templateKey: r.templateKey,
      version: r.version,
      divergedAt: r.divergedAt,
      updatedAt: r.updatedAt,
      granted: r.permissions.map((p) => p.permission.code).sort(),
      templateGranted: r.template ? r.template.permissions.map((p) => p.permission.code).sort() : null,
    }));
  }

  private async detailIn(tx: PrismaClient, key: string): Promise<RoleDetail> {
    const [rows, total, globals] = await Promise.all([this.loadRows(tx, key), this.catalogSize(tx), tx.role.findMany({ select: { id: true, name: true } })]);
    const row = rows[0];
    if (!row) throw roleNotFound();
    const roleIdByName = new Map(globals.map((g) => [g.name, g.id]));
    // Sólo se cuentan las personas de ESTE rol (no las de todos los roles de la cuenta).
    const members = await tx.userAccount.count({ where: { accountId: this.tenant.accountId, accountRoleId: row.id, isActive: true } });
    const summary = summarizeRole(row, { roleIdByName, members, permissionsTotal: total });
    const people = await tx.userAccount.findMany({
      where: { accountId: this.tenant.accountId, accountRoleId: row.id },
      select: { userId: true, isActive: true, user: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...summary,
      templateKey: row.templateKey,
      granted: row.granted,
      diff: row.templateGranted ? diffPermissions(row.templateGranted, row.granted) : { added: [], removed: [] },
      people: people.map((p) => ({
        userId: p.userId,
        name: [p.user.profile?.firstName, p.user.profile?.lastName].filter(Boolean).join(' ') || p.user.email,
        email: p.user.email,
        isActive: p.isActive,
      })),
    };
  }
}
