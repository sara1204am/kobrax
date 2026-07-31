import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { KOBRAX, MOBILE_ROLES, RoleType, isMobileRole } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { MailService, invitationBody } from '../../common/mail/mail.service';
import { formatInvitationCode, newInvitationCode, sha256hex } from '../auth/invitation-code';
import { emailTaken } from '../accounts/accounts.errors';
import { serializeMember, serializeProfile, serializeRole } from './users.serializer';
import { InviteMemberDto, UpdateMemberDto, UpdateProfileDto } from './dto/user.dto';
import {
  cannotEditSelf,
  lastAdmin,
  memberNotFound,
  notPending,
  profileNotFound,
  roleNotAllowed,
  seatLimitReached,
} from './users.errors';

const MEMBER_INCLUDE = { user: { include: { profile: true } }, role: true } as const;

/** Una invitación dura una semana: el invitado puede estar en campo sin ver el correo. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    private readonly mail: MailService,
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

  /**
   * Invita a un miembro (S2). **No hay tabla de invitaciones** (S2-D2): el invitado es un
   * `User` en estado `PENDING` + su membresía + un token de un solo uso de los que ya
   * existen. Así la lista, el conteo del plan y el badge "Pendiente" salen gratis, y no
   * hay migración ni policy RLS nueva.
   *
   * Devuelve el `invitationCode` en claro **una sola vez**, a quien invitó (S2-D9): si el
   * correo no llega —y con Gmail y una app sin dominio propio va a pasar— el código se
   * dicta o se manda por WhatsApp, que es el canal real en campo. En la base sólo vive el
   * hash; esto es lo mismo que ese admin ya puede hacer reenviando o re-invitando.
   */
  async invite(dto: InviteMemberDto) {
    const email = dto.email.toLowerCase();
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role || !isMobileRole(role.name)) throw roleNotAllowed();

    const code = newInvitationCode();
    // Hash real de un secreto que nadie conoce: el pendiente no puede entrar ni por
    // accidente. `login()` además corta antes por `status !== 'ACTIVE'`.
    const passwordHash = await hash(randomBytes(24).toString('hex'), KOBRAX.BCRYPT_WORK_FACTOR);
    const accountId = this.tenant.accountId;

    let created;
    try {
      created = await this.tx(async (tx) => {
        const account = await tx.account.findFirst({ where: { id: accountId } });
        if (!account) throw memberNotFound();
        // El conteo va DENTRO de la transacción: contar afuera y crear después es una
        // carrera que dos invitaciones simultáneas ganan (S2-D6, README R4).
        const taken = await tx.userAccount.count({ where: { isActive: true } });
        if (taken >= account.maxUsers) throw seatLimitReached(account.maxUsers);

        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            status: 'PENDING',
            profile: { create: { firstName: dto.firstName, lastName: dto.lastName } },
          },
        });
        const member = await tx.userAccount.create({
          data: { userId: user.id, accountId, roleId: role.id, isDefault: true },
          include: MEMBER_INCLUDE,
        });
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: sha256hex(code),
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
        });
        return { member, businessName: account.businessName };
      });
    } catch (err) {
      // `users.email` es @unique. Ese choque es la guarda real; chequear antes sería una
      // carrera con mejor cara. Si el correo ya está tomado, la salida es cancelar la
      // invitación vieja (S2-D5) o que esa persona inicie sesión.
      if ((err as { code?: string }).code === 'P2002') throw emailTaken();
      throw err;
    }

    await this.audit.record({
      entity: 'user_account',
      entityId: created.member.id,
      action: 'CREATE',
      after: { email, roleId: role.id, invited: true },
    });
    await this.sendInvitation(email, code, created.businessName);
    return { ...serializeMember(created.member), invitationCode: formatInvitationCode(code) };
  }

  /** Token nuevo + correo nuevo. Sólo para quien todavía no aceptó. */
  async resendInvitation(userId: string) {
    const code = newInvitationCode();
    const { member, businessName } = await this.tx(async (tx) => {
      const member = await tx.userAccount.findFirst({ where: { userId }, include: MEMBER_INCLUDE });
      if (!member) throw memberNotFound();
      if (member.user.status !== 'PENDING') throw notPending();
      const account = await tx.account.findFirst({ where: { id: this.tenant.accountId } });

      // Invalida el código anterior: uno vigente a la vez.
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId,
          tokenHash: sha256hex(code),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      return { member, businessName: account?.businessName ?? 'Kobrax' };
    });

    await this.audit.record({
      entity: 'user_account',
      entityId: member.id,
      action: 'UPDATE',
      after: { invitationResent: true },
    });
    await this.sendInvitation(member.user.email, code, businessName);
    return { ...serializeMember(member), invitationCode: formatInvitationCode(code) };
  }

  /**
   * Cancela una invitación **borrando** al pendiente (S2-D5). Desactivarlo no alcanza: el
   * `@unique` de `users.email` dejaría ese correo tomado para siempre, y un correo mal
   * escrito quemaría un asiento del plan. Contra un miembro que ya entró no se puede: ahí
   * el camino es desactivarlo.
   */
  async remove(userId: string): Promise<void> {
    if (userId === this.selfId) throw cannotEditSelf();
    const member = await this.tx(async (tx) => {
      const member = await tx.userAccount.findFirst({ where: { userId }, include: MEMBER_INCLUDE });
      if (!member) throw memberNotFound();
      if (member.user.status !== 'PENDING') throw notPending();

      // Un pendiente no tiene datos colgando: nunca registró un caso, un pago ni una
      // gestión. Se borra en orden de FK.
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.userAccount.delete({ where: { id: member.id } });
      await tx.profile.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
      return member;
    });

    await this.audit.record({
      entity: 'user_account',
      entityId: member.id,
      action: 'DELETE',
      before: { email: member.user.email, roleId: member.roleId },
    });
  }

  /** El envío va DESPUÉS del commit (S2-D7): un SMTP lento no puede tumbar el alta. */
  private async sendInvitation(email: string, code: string, businessName: string): Promise<void> {
    const inviter = await this.prisma.user.findUnique({
      where: { id: this.selfId },
      include: { profile: true },
    });
    const invitedBy = inviter?.profile
      ? `${inviter.profile.firstName} ${inviter.profile.lastName}`.trim()
      : (inviter?.email ?? 'Tu equipo');
    const { subject, text } = invitationBody({ businessName, invitedBy, code });
    await this.mail.send(email, subject, text);
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
