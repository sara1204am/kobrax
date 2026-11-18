import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { MailService, emailVerificationBody } from '../../common/mail/mail.service';

/** El enlace de confirmación vive 48 horas y sirve una sola vez. */
export const EMAIL_VERIFY_TTL_MS = 48 * 60 * 60 * 1000;
/** Entre un envío y el siguiente (reenviar) deben pasar al menos 60 s: frena el reenvío en ráfaga sin molestar a una persona real. */
export const EMAIL_VERIFY_COOLDOWN_MS = 60 * 1000;

export const emailVerifyInvalid = () =>
  new NotFoundException({ code: 'EMAIL_VERIFY_INVALID', message: 'El enlace no es válido o ya venció' });

/**
 * Confirmación del correo de quien crea una cuenta. Sin esto cualquiera podía registrarse con el correo de otra persona.
 *
 * - El registro envía un enlace de un solo uso (48 h). Solo se guarda su huella (SHA-256), nunca el enlace.
 * - Quien entra por INVITACIÓN nace confirmado: el código le llegó a ese correo (lo marca `PasswordService.acceptInvitation`).
 * - Sin confirmar se puede entrar y trabajar; lo sensible (invitar personas, exportar datos) lo frena `RequireVerifiedEmailGuard`.
 * - Un correo que falla NO rompe nada: la persona puede pedir otro desde el aviso del panel.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly mail: MailService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /** ¿Este usuario ya confirmó su correo? Sin usuario (la plataforma) cuenta como sí: no es una persona de empresa. */
  async isVerified(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    return u ? u.emailVerifiedAt != null : true;
  }

  /**
   * Crea un enlace nuevo (anula los anteriores sin usar) y lo manda al correo. Devuelve `false` si no hizo falta (ya confirmado) o si se
   * pidió demasiado seguido; nunca lanza por un fallo del correo.
   */
  async send(userId: string, opts: { respectCooldown?: boolean } = {}): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user || user.emailVerifiedAt) return false;
    if (opts.respectCooldown) {
      const last = await this.prisma.emailVerificationToken.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (last && Date.now() - last.createdAt.getTime() < EMAIL_VERIFY_COOLDOWN_MS) return false;
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.emailVerificationToken.create({ data: { userId, tokenHash: this.hash(token), expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS) } }),
    ]);
    const link = `${this.config.appUrl.replace(/\/$/, '')}/verificar-correo?token=${token}`;
    try {
      const { subject, text } = emailVerificationBody(link);
      await this.mail.send(user.email, subject, text);
    } catch (e) {
      this.logger.error(`No se pudo enviar la confirmación de correo (${userId}): ${e instanceof Error ? e.message : String(e)}`);
    }
    return true;
  }

  /** Igual que `send`, a partir del correo (lo que conoce el alta de cuenta). No lanza nunca. */
  async sendForEmail(email: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
      if (user) await this.send(user.id);
    } catch (e) {
      this.logger.error(`No se pudo preparar la confirmación de correo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** La persona abrió el enlace y pulsó «Confirmar». Genérico si no existe, venció o ya se usó. */
  async confirm(token: string): Promise<void> {
    const tokenHash = this.hash(token);
    const found = await this.prisma.emailVerificationToken.findFirst({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } } });
    if (!found) throw emailVerifyInvalid();
    const claimed = await this.prisma.emailVerificationToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count === 0) throw emailVerifyInvalid();
    await this.prisma.user.updateMany({ where: { id: found.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  }
}
