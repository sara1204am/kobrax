import { branchAssignmentExists, branchInactive, branchNotFound } from '../branches/branches.errors';
import { isUniqueViolation } from '../../common/unique-violation';
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { AgendaItemStatus, CreditAssignmentKind, CreditStatus, RouteStatus } from '@prisma/client';
import { KOBRAX, MOBILE_ROLES, Permission, RoleType, isMobileRole } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { MailService, invitationBody } from '../../common/mail/mail.service';
import { PlanLimitsService } from '../../common/plan/plan-limits.service';
import { formatInvitationCode, newInvitationCode, sha256hex } from '../auth/invitation-code';
import { emailTaken } from '../accounts/accounts.errors';
import { AssignmentService } from '../assignments/assignment.service';
import { AuthzVersionService, type PendingVersion } from '../auth/authz-version.service';
import { SessionService } from '../auth/session.service';
import { OfficeScopeService } from '../../common/office-scope/office-scope.service';
import { isAssignable, type AssignmentChange } from '../assignments/assignment-rules';
import { serializeMember, serializeProfile, serializeRole } from './users.serializer';
import { InviteMemberDto, UpdateMemberDto, UpdateProfileDto } from './dto/user.dto';
import {
  cannotEditSelf,
  lastAdmin,
  managerNeedsOffice,
  cannotRevokeSuperior,
  memberNotFound,
  notPending,
  profileNotFound,
  reassignTargetInvalid,
  roleNotAllowed,
  userHasPendingWork,
} from './users.errors';
import { AuthorizationService } from '../../common/authz/authorization.service';
import { PolicyService } from '../../common/authz/policy.service';
import { isReservedRole, tierOf } from '../../common/authz/tier';

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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly plan: PlanLimitsService,
    private readonly assignments: AssignmentService,
    private readonly authz: AuthzVersionService,
    private readonly sessions: SessionService,
    private readonly office: OfficeScopeService,
    private readonly access: AuthorizationService = new AuthorizationService(tenant),
    /** F14 · F2: `member.invite` / `member.assignRole`. Lo inyecta Nest; los specs que no invitan ni cambian roles no lo necesitan. */
    private readonly policies: PolicyService,
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
    const rows = await this.tx(async (tx) => {
      // Sin `where` de tenant: lo pone la RLS. `user_accounts` no tiene deletedAt.
      const all = await tx.userAccount.findMany({ include: MEMBER_INCLUDE, orderBy: { joinedAt: 'asc' } });
      // F14 · F1 (R-02): sólo a quien el actor ve según su alcance por oficina.
      const visible = await this.office.visibleMemberIds(tx, all.map((m) => m.userId));
      return all.filter((m) => visible.has(m.userId));
    });
    return rows.map(serializeMember);
  }

  /**
   * Lo que una persona tiene a su nombre y que no puede quedar huérfano si se la desactiva (F4/11 · D1): gestiones
   * pendientes, créditos a su cargo (responsable vigente, sin pagar ni castigar) y rutas armadas o en curso.
   */
  private async pendingWork(tx: PrismaClient, userId: string): Promise<{ agenda: number; credits: number; routes: number }> {
    const [agenda, credits, routes] = await Promise.all([
      tx.agendaItem.count({ where: { assigneeId: userId, status: AgendaItemStatus.SCHEDULED, deletedAt: null } }),
      tx.credit.count({ where: { assignedManagerId: userId, deletedAt: null, writtenOffAt: null, status: { notIn: [CreditStatus.PAID, CreditStatus.CANCELLED] } } }),
      tx.routePlan.count({ where: { collectorId: userId, status: { in: [RouteStatus.PLANNED, RouteStatus.IN_PROGRESS] } } }),
    ]);
    return { agenda, credits, routes };
  }

  /**
   * Pasa todo lo pendiente de `from` a `to`, en la transacción de quien llama:
   *  1. los créditos, por el servicio de asignaciones (que además mueve la agenda de cada crédito);
   *  2. el resto de sus gestiones pendientes;
   *  3. sus rutas: pasan al destinatario si ese día no tiene una; si ya tiene, se cancelan (la base solo admite una ruta por
   *     cobrador y día) y sus visitas quedan libres para entrar a la del destinatario;
   *  4. sus coberturas temporales y de apoyo, que se revocan.
   */
  private async handOver(tx: PrismaClient, from: string, to: string): Promise<{ changes: AssignmentChange[]; routesMoved: number; routesCancelled: number }> {
    const target = await tx.userAccount.findFirst({ where: { userId: to }, select: { userId: true, isActive: true, role: { select: { name: true } } } });
    if (to === from || !isAssignable(target ? { userId: target.userId, isActive: target.isActive, role: target.role.name } : undefined, this.selfId)) {
      throw reassignTargetInvalid();
    }
    const actor = this.selfId;
    const now = new Date();

    const credits = await tx.credit.findMany({
      where: { assignedManagerId: from, deletedAt: null, writtenOffAt: null, status: { notIn: [CreditStatus.PAID, CreditStatus.CANCELLED] } },
      select: { id: true },
    });
    const changes = await this.assignments.apply(tx, credits.map((c) => ({ creditId: c.id, to })), 'BULK_REASSIGN');

    await tx.agendaItem.updateMany({ where: { assigneeId: from, status: AgendaItemStatus.SCHEDULED, deletedAt: null }, data: { assigneeId: to, updatedBy: actor } });

    let routesMoved = 0;
    let routesCancelled = 0;
    const routes = await tx.routePlan.findMany({ where: { collectorId: from, status: { in: [RouteStatus.PLANNED, RouteStatus.IN_PROGRESS] } }, select: { id: true, plannedDate: true } });
    for (const route of routes) {
      const clash = await tx.routePlan.findFirst({ where: { collectorId: to, plannedDate: route.plannedDate }, select: { id: true } });
      if (clash) {
        await tx.routePlan.update({ where: { id: route.id }, data: { status: RouteStatus.CANCELLED } });
        // La ruta cancelada suelta sus visitas: siguen pendientes en la agenda (ya del destinatario) y entran a su ruta.
        await tx.routeStop.updateMany({ where: { routeId: route.id, agendaItemId: { not: null } }, data: { agendaItemId: null } });
        routesCancelled += 1;
      } else {
        await tx.routePlan.update({ where: { id: route.id }, data: { collectorId: to } });
        routesMoved += 1;
      }
    }

    await tx.creditAssignment.updateMany({
      where: { userId: from, revokedAt: null, kind: { in: [CreditAssignmentKind.TEMPORAL, CreditAssignmentKind.APOYO] } },
      data: { revokedAt: now, revokedBy: actor },
    });
    return { changes, routesMoved, routesCancelled };
  }

  /**
   * Deja la asignación vigente de la persona en `branchId` (o ninguna con `null`). UNA sola vigente por persona y cuenta (índice
   * temporal): se revoca la anterior y se crea la nueva en la misma transacción. Quien ya estaba ahí no se toca. El espejo
   * `user_accounts.branch_id` lo escribe quien llama (mismo `UPDATE` que el rol y el estado) para que queden siempre iguales.
   */
  private async syncAssignment(tx: PrismaClient, userId: string, branchId: string | null): Promise<void> {
    const accountId = this.tenant.accountId;
    const current = await tx.userBranchAssignment.findMany({ where: { accountId, userId, revokedAt: null }, select: { id: true, branchId: true } });
    const stale = current.filter((a) => a.branchId !== branchId);
    if (stale.length > 0) await tx.userBranchAssignment.updateMany({ where: { id: { in: stale.map((a) => a.id) } }, data: { revokedAt: new Date() } });
    if (branchId && !current.some((a) => a.branchId === branchId)) {
      try {
        await tx.userBranchAssignment.create({ data: { accountId, userId, branchId, isPrimary: true, createdBy: this.tenant.userId ?? null } });
      } catch (e) {
        // El índice único parcial (una vigente por persona y cuenta) ganó una carrera: 409 claro, no 500.
        if (isUniqueViolation(e)) throw branchAssignmentExists(userId, branchId);
        throw e;
      }
    }
  }

  /** F14 · F1: cierra las sesiones abiertas de un miembro EN ESTA cuenta (no cambia su rol; tiene que volver a entrar). */
  async revokeMemberSessions(userId: string): Promise<{ sessions: number }> {
    if (userId === this.selfId) throw cannotEditSelf();
    await this.tx(async (tx) => {
      const member = await tx.userAccount.findFirst({ where: { userId }, select: { userId: true, role: { select: { name: true } } } });
      if (!member) throw memberNotFound();
      const visible = await this.office.visibleMemberIds(tx, [userId]);
      if (!visible.has(userId)) throw memberNotFound();
      // Ver a alguien no es tener autoridad sobre él: quien no administra la cuenta (el gerente regional) sólo cierra las sesiones
      // de quienes están por debajo de él, nunca las de un administrador ni las de otro gerente de su subárbol.
      const superior: string[] = [RoleType.SUPER_ADMIN, RoleType.ACCOUNT_ADMIN, RoleType.MANAGER];
      if (!this.access.can(Permission.USER_WRITE) && superior.includes(member.role.name)) throw cannotRevokeSuperior();
    });
    const sessions = await this.sessions.revokeAccountSessions(userId, this.tenant.accountId);
    await this.audit.record({
      entity: 'user_account',
      entityId: userId,
      action: 'SESSION_REVOKE',
      after: { reason: 'ADMIN_REQUEST', sessions },
    });
    return { sessions };
  }

  async updateMember(userId: string, dto: UpdateMemberDto) {
    if (userId === this.selfId) throw cannotEditSelf();

    let authzPending: PendingVersion[] = [];
    let handover: { changes: AssignmentChange[]; routesMoved: number; routesCancelled: number; work: { agenda: number; credits: number; routes: number } } | undefined;
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
        // `user.status` ACTIVE además de `isActive`: un admin invitado que nunca aceptó
        // sigue siendo un `userAccount` activo, y contarlo dejaba pasar la jugada que este
        // chequeo existe para frenar — quedarse sin ningún administrador que pueda entrar.
        const otherAdmins = await tx.userAccount.count({
          where: {
            isActive: true,
            userId: { not: userId },
            role: { name: RoleType.ACCOUNT_ADMIN },
            user: { status: 'ACTIVE' },
          },
        });
        if (otherAdmins === 0) throw lastAdmin();
      }

      // F14 · F2 (H-3, H-13): quien edita está por encima de la persona; el rol y la oficina nuevos caen en su jerarquía y alcance.
      // Sólo si cambia algo de verdad: el formulario reenvía la oficina actual junto con otros campos y eso no es un movimiento jerárquico.
      const changesBranch = dto.branchId !== undefined && dto.branchId !== before.branchId;
      if (changesRole || changesBranch) {
        await this.policies.assert('member.assignRole', { userId, roleId: changesRole ? dto.roleId : undefined, branchId: changesBranch ? dto.branchId : undefined }, tx);
      }

      // Reactivar es la otra puerta al techo del plan: `invite()` frena, pero desactivar y volver
      // a activar entraba sin contar asientos. Mismo criterio que allá y dentro de la transacción,
      // por la misma carrera (S2-D6).
      if (dto.isActive === true && !before.isActive) {
        await this.plan.assertRoom('users', tx);
      }

      /*
       * 🔴 No se desactiva a quien tiene trabajo a su nombre (F4/11 · D1). Sin destinatario, se rechaza con el conteo; con él, todo
       * pasa en ESTA transacción y recién entonces se desactiva: nunca queda una persona inactiva con gestiones, créditos o rutas.
       */
      if (dto.isActive === false && before.isActive) {
        const work = await this.pendingWork(tx, userId);
        if (work.agenda + work.credits + work.routes > 0) {
          if (!dto.reassignToUserId) throw userHasPendingWork(work);
          handover = { ...(await this.handOver(tx, userId, dto.reassignToUserId)), work };
        }
      }

      // La agencia tiene que existir en esta cuenta y estar activa (la RLS acota `branches` al tenant). `null` la quita.
      if (dto.branchId) {
        const branch = await tx.branch.findFirst({ where: { id: dto.branchId, deletedAt: null }, select: { active: true } });
        if (!branch) throw branchNotFound();
        if (!branch.active) throw branchInactive();
      }

      // Un gerente regional sin oficina no tendría alcance: el rol resultante MANAGER exige una oficina (la que se manda o la vigente).
      const resultingRoleId = dto.roleId ?? before.roleId;
      if (dto.roleId !== undefined || dto.branchId !== undefined) {
        const resulting = changesRole ? await tx.role.findUnique({ where: { id: resultingRoleId }, select: { name: true } }) : before.role;
        const resultingBranch = dto.branchId !== undefined ? dto.branchId : before.branchId;
        if (resulting?.name === RoleType.MANAGER && !resultingBranch) throw managerNeedsOffice();
      }

      // F13: la oficina de la persona vive en `user_branch_assignments` (fuente del alcance) y se espeja en `user_accounts.branch_id`.
      if (dto.branchId !== undefined) await this.syncAssignment(tx, userId, dto.branchId);

      const updated = await tx.userAccount.update({
        where: { id: before.id },
        data: { roleId: dto.roleId, isActive: dto.isActive, branchId: dto.branchId },
        include: MEMBER_INCLUDE,
      });
      // F14 · F1 (H-2): un cambio de rol, de oficina o de estado sube la versión de ESTA membresía en la misma transacción; el
      // próximo request con el token viejo recibe AUTHZ_STALE y renueva con lo nuevo.
      const authzChanged = changesRole || dto.isActive !== undefined && dto.isActive !== before.isActive || dto.branchId !== undefined && dto.branchId !== before.branchId;
      if (authzChanged) authzPending = await this.authz.bumpInTx(tx, this.tenant.accountId, [before.id]);
      return { before, updated };
    });

    await this.authz.publish(authzPending);
    if (dto.isActive === false && before.isActive) {
      // Desactivar la membresía cierra sus sesiones EN ESTA CUENTA (las de otros tenants no se tocan).
      // Ya está commiteado y la versión de autorización protege el token aunque esto falle: no se convierte en un 500.
      try {
        const closed = await this.sessions.revokeAccountSessions(userId, this.tenant.accountId);
        await this.audit.record({
          entity: 'user_account',
          entityId: updated.id,
          action: 'SESSION_REVOKE',
          after: { reason: 'MEMBERSHIP_DEACTIVATED', sessions: closed },
        });
      } catch (e) {
        this.logger.error(`Desactivada la membresía ${updated.id} pero no se cerraron sus sesiones: ${(e as Error).message}`);
      }
    }

    if (handover) {
      await this.assignments.auditChanges(handover.changes, { reason: 'DEACTIVATED_MEMBER', from: userId });
      await this.audit.record({
        entity: 'user_account',
        entityId: updated.id,
        action: 'REASSIGN_ON_DEACTIVATE',
        after: { to: dto.reassignToUserId, ...handover.work, routesMoved: handover.routesMoved, routesCancelled: handover.routesCancelled },
      });
    }

    await this.audit.record({
      entity: 'user_account',
      entityId: updated.id,
      action: 'UPDATE',
      before: { roleId: before.roleId, isActive: before.isActive, branchId: before.branchId },
      after: { roleId: updated.roleId, isActive: updated.isActive, branchId: updated.branchId },
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

    if (role.name === RoleType.MANAGER && !dto.branchId) throw managerNeedsOffice();

    const code = newInvitationCode();
    // Hash real de un secreto que nadie conoce: el pendiente no puede entrar ni por
    // accidente. `login()` además corta antes por `status !== 'ACTIVE'`.
    const passwordHash = await hash(randomBytes(24).toString('hex'), KOBRAX.BCRYPT_WORK_FACTOR);
    const accountId = this.tenant.accountId;

    let created;
    try {
      created = await this.tx(async (tx) => {
        // Sólo el nombre: es lo que lleva el correo de invitación. El tope lo mira `assertRoom`.
        const account = await tx.account.findFirst({
          where: { id: accountId },
          select: { businessName: true },
        });
        if (!account) throw memberNotFound();
        // El conteo va DENTRO de la transacción: contar afuera y crear después es una
        // carrera que dos invitaciones simultáneas ganan (S2-D6, README R4).
        await this.plan.assertRoom('users', tx);
        // F14 · F2 (H-3, H-13): rol de tier estrictamente inferior, oficina dentro del alcance y nunca un rol reservado.
        await this.policies.assert('member.invite', { roleId: role.id, branchId: dto.branchId }, tx);

        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            status: 'PENDING',
            profile: { create: { firstName: dto.firstName, lastName: dto.lastName } },
          },
        });
        if (dto.branchId) {
          const branch = await tx.branch.findFirst({ where: { id: dto.branchId, deletedAt: null }, select: { active: true } });
          if (!branch) throw branchNotFound();
          if (!branch.active) throw branchInactive();
          await this.syncAssignment(tx, user.id, dto.branchId);
        }
        const member = await tx.userAccount.create({
          data: { userId: user.id, accountId, roleId: role.id, isDefault: true, branchId: dto.branchId ?? null },
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
      //
      // ponytail: como acá SIEMPRE se crea un `User` nuevo, esto también implica que **no se
      // puede invitar a alguien que ya tiene cuenta en otro tenant**, aunque el modelo lo
      // soporte (el login tiene paso de selección de empresa). Para habilitarlo hay que
      // buscar al usuario por email y, si existe, crear sólo el `userAccount`. Nadie lo pidió.
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

  /**
   * El envío va DESPUÉS del commit (S2-D7) y **no se espera**: medido contra Gmail, el
   * handshake SMTP son ~3,4 s pegados a la respuesta, en una pantalla que se usa parada
   * en la calle. La invitación ya está persistida y el código ya viaja en la respuesta
   * (S2-D9), así que el correo es un extra, no el resultado.
   *
   * Un fallo del envío se loguea y no rompe el alta — que es justo lo que dice R5: la
   * invitación queda "Pendiente" con su botón de Reenviar. Esperar el envío tenía el
   * peor de los dos mundos: lento **y** un 500 con el miembro ya creado.
   */
  private async sendInvitation(email: string, code: string, businessName: string): Promise<void> {
    const inviter = await this.prisma.user.findUnique({
      where: { id: this.selfId },
      include: { profile: true },
    });
    const invitedBy = inviter?.profile
      ? `${inviter.profile.firstName} ${inviter.profile.lastName}`.trim()
      : (inviter?.email ?? 'Tu equipo');
    const { subject, text } = invitationBody({ businessName, invitedBy, code });
    void this.mail.send(email, subject, text).catch((err: Error) => {
      this.logger.error(`No se pudo enviar la invitación a ${email}: ${err.message}`);
    });
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
          paymentQrUrl: dto.paymentQrUrl,
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

  /**
   * Los roles que quien pregunta puede OFRECER al invitar o cambiar un rol (F14 · F2, H-3/H-13): de `tier` estrictamente inferior al suyo y
   * ninguno reservado (el ACCOUNT_ADMIN no se otorga por esta vía). El servidor lo vuelve a exigir en `member.invite`/`member.assignRole`.
   */
  async listRoles() {
    const { roles, mine } = await this.tx(async (tx) => ({
      roles: await tx.role.findMany({ where: { name: { in: [...MOBILE_ROLES] } }, orderBy: { level: 'desc' } }),
      mine: await tx.userAccount.findFirst({ where: { userId: this.selfId, accountId: this.tenant.accountId }, select: { role: { select: { name: true, level: true } } } }),
    }));
    const myTier = mine ? tierOf(mine.role) : -1;
    return roles.filter((r) => !isReservedRole(r) && tierOf(r) < myTier).map(serializeRole);
  }
}
