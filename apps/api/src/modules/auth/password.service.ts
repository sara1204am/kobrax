import { Injectable, Logger } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { KOBRAX, isPasswordValid } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { SessionService } from './session.service';
import { AppConfigService } from '../../config/app-config.service';
import { invalidCredentials, resetTokenInvalid, weakPassword } from './auth.errors';

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
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Inicia la recuperación. Responde 200 SIEMPRE (anti-enumeration); solo crea el
   * token si el usuario existe y está activo. En dev se loguea el token (no hay
   * servicio de email todavía — el envío real llega en F8).
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
    // TODO(F8): enviar el token por email en producción.
  }

  /** Completa el reset con un token válido + nueva contraseña (revoca todas las sesiones). */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!isPasswordValid(newPassword)) throw weakPassword();

    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash: this.hashToken(token), usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record) throw resetTokenInvalid();

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
