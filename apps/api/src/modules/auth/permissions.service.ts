import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface ResolvedPermissions {
  permissions: string[];
  /** Clave del rol de la cuenta (`account_roles.key`); ausente si la membresía sólo tiene el rol global (p. ej. SUPER_ADMIN histórico). */
  roleKey?: string;
  source: 'account' | 'global';
}

/**
 * Resuelve los permisos efectivos de una membresía.
 *
 * F14 · F5 (ADR-F14-01): salen del ROL DE LA CUENTA (`account_role_permissions`, copia de una plantilla), no de una constante igual para todas las
 * empresas. Si la membresía todavía no tiene rol de cuenta (`account_role_id` nulo: sólo el SUPER_ADMIN histórico) se usa el rol global, como hasta ahora.
 * No hay caché: sólo se consulta al emitir y al renovar el token; en cada petición los permisos vienen del token y su vigencia la controlan `av`/`pv`.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Permisos del rol global (`role_permissions` es global, sin RLS). */
  async forRole(roleId: string): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { code: true } } },
    });
    return rows.map((r) => r.permission.code);
  }

  /** Dentro de una transacción de la cuenta (el refresco): el rol de la cuenta de la membresía, o el global si no tiene. */
  async forMembershipIn(tx: PrismaClient, ua: { accountRoleId: string | null; roleId: string }): Promise<ResolvedPermissions> {
    if (ua.accountRoleId) {
      const role = await tx.accountRole.findFirst({
        where: { id: ua.accountRoleId, deletedAt: null },
        select: { key: true, permissions: { select: { permission: { select: { code: true } } } } },
      });
      if (role) return { permissions: role.permissions.map((p) => p.permission.code), roleKey: role.key, source: 'account' };
    }
    return { permissions: await this.forRole(ua.roleId), source: 'global' };
  }

  /** Fuera de una transacción (el inicio de sesión): lee la membresía de la cuenta y resuelve sus permisos. */
  async forMembership(accountId: string, userId: string, fallbackRoleId: string): Promise<ResolvedPermissions> {
    return this.prisma.withSystemTenant(accountId, async (tx) => {
      const ua = await tx.userAccount.findFirst({ where: { userId, accountId, isActive: true }, select: { accountRoleId: true, roleId: true } });
      return this.forMembershipIn(tx as unknown as PrismaClient, ua ?? { accountRoleId: null, roleId: fallbackRoleId });
    });
  }
}
