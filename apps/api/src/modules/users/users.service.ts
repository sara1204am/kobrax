import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { MOBILE_ROLES, RoleType, isMobileRole } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { serializeMember, serializeProfile, serializeRole } from './users.serializer';
import { UpdateMemberDto, UpdateProfileDto } from './dto/user.dto';
import { cannotEditSelf, lastAdmin, memberNotFound, profileNotFound, roleNotAllowed } from './users.errors';

const MEMBER_INCLUDE = { user: { include: { profile: true } }, role: true } as const;

/**
 * Miembros del tenant y perfil propio (módulo CUENTA · S0).
 *
 * 🔴 `users`, `profiles` y `roles` son tablas GLOBALES sin RLS
 * (`prisma/rls/001_enable_rls.sql`). Toda lectura de miembros arranca en
 * `user_accounts` — que sí tiene policy — y trae el resto por `include`.
 * Un `findMany` directo sobre `user` devolvería los usuarios de todos los tenants.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private get selfId(): string {
    const id = this.tenant.userId;
    if (!id) throw new Error('UsersService requiere un request autenticado');
    return id;
  }

  /** Miembros del tenant, activos e inactivos (la lista deja reactivar al desactivado). */
  async list() {
    const rows = await this.tx((tx) =>
      // Sin `where` de tenant: lo pone la RLS. `user_accounts` no tiene deletedAt.
      tx.userAccount.findMany({ include: MEMBER_INCLUDE, orderBy: { joinedAt: 'asc' } }),
    );
    return rows.map(serializeMember);
  }

  async updateMember(userId: string, dto: UpdateMemberDto) {
    if (userId === this.selfId) throw cannotEditSelf();

    const { before, updated } = await this.tx(async (tx) => {
      const before = await tx.userAccount.findFirst({ where: { userId }, include: MEMBER_INCLUDE });
      if (!before) throw memberNotFound();

      const changesRole = dto.roleId !== undefined && dto.roleId !== before.roleId;
      if (changesRole) {
        const role = await tx.role.findUnique({ where: { id: dto.roleId } });
        if (!role || !isMobileRole(role.name)) throw roleNotAllowed();
      }

      // ¿Esta edición le saca el último administrador activo a la cuenta?
      const dropsThisAdmin =
        before.role.name === RoleType.ACCOUNT_ADMIN && (dto.isActive === false || changesRole);
      if (dropsThisAdmin) {
        const otherAdmins = await tx.userAccount.count({
          where: { isActive: true, userId: { not: userId }, role: { name: RoleType.ACCOUNT_ADMIN } },
        });
        if (otherAdmins === 0) throw lastAdmin();
      }

      const updated = await tx.userAccount.update({
        where: { id: before.id },
        data: { roleId: dto.roleId, isActive: dto.isActive },
        include: MEMBER_INCLUDE,
      });
      return { before, updated };
    });

    await this.audit.record({
      entity: 'user_account',
      entityId: updated.id,
      action: 'UPDATE',
      before: { roleId: before.roleId, isActive: before.isActive },
      after: { roleId: updated.roleId, isActive: updated.isActive },
    });
    return serializeMember(updated);
  }

  async getMyProfile() {
    const user = await this.tx((tx) =>
      tx.user.findUnique({ where: { id: this.selfId }, include: { profile: true } }),
    );
    if (!user) throw profileNotFound();
    return serializeProfile(user);
  }

  async updateMyProfile(dto: UpdateProfileDto) {
    const userId = this.selfId;
    const { before, user } = await this.tx(async (tx) => {
      const before = await tx.profile.findUnique({ where: { userId } });
      if (!before) throw profileNotFound();
      await tx.profile.update({
        where: { userId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          photoUrl: dto.photoUrl,
        },
      });
      const user = await tx.user.findUnique({ where: { id: userId }, include: { profile: true } });
      return { before, user: user! };
    });

    await this.audit.record({
      entity: 'profile',
      entityId: before.id,
      action: 'UPDATE',
      before,
      after: user.profile,
      redactKeys: ['phone', 'documentNumber'],
    });
    return serializeProfile(user);
  }

  /** Sólo los roles que el móvil administra (D2); el selector necesita los ids reales. */
  async listRoles() {
    const roles = await this.tx((tx) =>
      tx.role.findMany({ where: { name: { in: [...MOBILE_ROLES] } }, orderBy: { level: 'desc' } }),
    );
    return roles.map(serializeRole);
  }
}
