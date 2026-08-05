import { Injectable, Logger } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { KOBRAX, isPasswordValid } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { SessionService } from './session.service';
import { AppConfigService } from '../../config/app-config.service';
import { MailService, passwordResetBody } from '../../common/mail/mail.service';
import { normalizeInvitationCode, sha256hex } from './invitation-code';
import { invitationInvalid, invalidCredentials, resetTokenInvalid, weakPassword } from './auth.errors';

/** Vida del token de recuperación de contraseña. */
const RESET_TTL_MS = 30 * 60 * 1000;

/**
 * Recuperación y cambio de contraseña (F2b). Tras un reset/change exitoso se
 * **revocan todas las sesiones** del usuario (forzar re-login en todos los dispositivos).
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
    private readonly mail: MailService,
  ) {}

  private hashToken(token: string): string {
    return sha256hex(token);
  }

  /**
   * Inicia la recuperación. Responde 200 SIEMPRE (anti-enumeration); solo crea el
   * token si el usuario existe y está activo.
   *
   * El envío estuvo roto desde siempre (`TODO(F8)`: se generaba el token y nada lo
   * mandaba). Lo arregla S2 con el `MailService`, que es el mismo que usa la invitación.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || user.status !== 'ACTIVE') return;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    if (!this.config.isProduction) {
      this.logger.warn(`[DEV] Reset token para ${user.email}: ${token}`);
    }
    const { subject, text } = passwordResetBody(token);
    await this.mail.send(user.email, subject, text);
  }

  // ── Invitación (CUENTA · S2) ───────────────────────────────────────────────
  //
  // El invitado es un `User` en estado PENDING creado por `UsersService.invite`, y su
  // código vive en la misma tabla de tokens de un solo uso que el reset (S2-D2): los dos
  // flujos hacen literalmente lo mismo — probar que sos dueño de ese correo y fijar una
  // contraseña. Por eso no hay tabla `account_invitations` ni servicio de tokens nuevo.

  /** Token vigente de un invitado que todavía no aceptó. */
  private async findInvitation(rawCode: string) {
    const record = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: this.hashToken(normalizeInvitationCode(rawCode)),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: { include: { profile: true } } },
    });
    // `status !== PENDING` significa que ya aceptó (o que es un token de reset, no de
    // invitación): en los dos casos este camino no es el suyo.
    if (!record || record.user.status !== 'PENDING') throw invitationInvalid();
    return record;
  }

  /** Datos para pintar la pantalla de aceptar. Público: no devuelve nada que no sepa ya el invitado. */
  async getInvitation(rawCode: string): Promise<{
    email: string;
    firstName: string | null;
    businessName: string | null;
  }> {
    const record = await this.findInvitation(rawCode);
    // Reusa la función SECURITY DEFINER del login: `user_accounts` y `accounts` tienen
    // RLS y acá no hay contexto de tenant que abrir todavía.
    const rows = await this.prisma.$queryRaw<{ account_name: string }[]>`
      SELECT * FROM auth_memberships(${record.userId})`;
    return {
      email: record.user.email,
      firstName: record.user.profile?.firstName ?? null,
      businessName: rows[0]?.account_name ?? null,
    };
  }

  /**
   * Acepta la invitación: fija la contraseña y **activa** al usuario. No emite tokens
   * (S2-D8) — el móvil hace `POST /auth/login` a continuación y hereda toda la máquina
   * de estados (MFA obligatorio, selección de empresa).
   */
  async acceptInvitation(
    rawCode: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ email: string }> {
    if (!isPasswordValid(password)) throw weakPassword();
    // ponytail: leer el token acá y marcarlo usado más abajo es una ventana en la que dos
    // POST simultáneos con el mismo código pasan los dos (gana la última contraseña). Hace
    // falta tener el código, así que se vive con eso; si aparece un caso real, la salida es
    // un `updateMany` condicional sobre `usedAt: null` y abortar si actualizó 0 filas.
    const record = await this.findInvitation(rawCode);
    const passwordHash = await hash(password, KOBRAX.BCRYPT_WORK_FACTOR);
    const rows = await this.prisma.$queryRaw<{ account_id: string }[]>`
      SELECT * FROM auth_memberships(${record.userId})`;
    const accountId = rows[0]?.account_id;
    if (!accountId) throw invitationInvalid();

    await this.prisma.withTenant(accountId, async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, status: 'ACTIVE', requiresPasswordChange: false },
      });
      // Un solo uso: marca éste e invalida cualquier otro pendiente del usuario.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      // A mano y no vía AuditService: es un endpoint público, sin contexto de request,
      // donde ese servicio no-opea en silencio (misma razón que S4-D7).
      await tx.auditLog.create({
        data: {
          accountId,
          userId: record.userId,
          action: 'UPDATE',
          entity: 'user',
          entityId: record.userId,
          after: { status: 'ACTIVE', invitationAccepted: true },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
    });
    return { email: record.user.email };
  }

  /** Completa el reset con un token válido + nueva contraseña (revoca todas las sesiones). */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!isPasswordValid(newPassword)) throw weakPassword();

    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash: this.hashToken(token), usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    // El código de invitación vive en esta MISMA tabla (S2-D2), así que hay que rechazarlo
    // acá: gastado por este camino, el invitado quedaba con contraseña nueva pero todavía
    // PENDING —sin poder entrar y sin código— y la única salida era pedir un reenvío.
    // Simétrico a `findInvitation`, que rechaza los tokens de quien no está PENDING.
    // `forgotPassword` sólo emite para usuarios ACTIVE, así que el filtro no deja a nadie afuera.
    if (!record || record.user.status !== 'ACTIVE') throw resetTokenInvalid();

    const passwordHash = await hash(newPassword, KOBRAX.BCRYPT_WORK_FACTOR);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, requiresPasswordChange: false, failedLoginAttempts: 0, lockedUntil: null },
      }),
      // Un solo uso: marca este token e invalida cualquier otro pendiente del usuario.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    await this.sessions.revokeAll(record.userId);
  }

  /** Cambio voluntario/forzado (Bearer): verifica la actual, aplica policy, revoca todas las sesiones. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw invalidCredentials();
    if (!(await compare(currentPassword, user.passwordHash))) throw invalidCredentials();
    if (!isPasswordValid(newPassword)) throw weakPassword();

    const passwordHash = await hash(newPassword, KOBRAX.BCRYPT_WORK_FACTOR);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, requiresPasswordChange: false },
    });
    await this.sessions.revokeAll(userId);
  }
}
