import { Injectable, Logger } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PLATFORM_PERMISSIONS } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TokenService } from '../auth/token.service';
import { generateSecret, otpauthUrl, verifyTotp } from '../auth/totp';
import { platformAccessEnabled } from './platform-switches';

export type PlatformLoginResult =
  | { step: 'done'; accessToken: string }
  /** Primer ingreso: el MFA es obligatorio y todavía no está enrolado. Se muestra el secreto una vez; se confirma con `mfa/confirm`. */
  | { step: 'mfa_setup'; secret: string; otpauthUrl: string };

/** Hash válido (mismo costo que los reales) de una contraseña que nadie conoce: se compara contra él cuando el correo no existe, para no filtrar por tiempo si existe. */
let dummyHash: Promise<string> | undefined;
const dummy = (): Promise<string> => (dummyHash ??= hash(randomUUID(), 12));

/**
 * F14 · F5 (ADR-F14-08, H-11): el inicio de sesión de la persona de plataforma. Es aparte del de empresa a propósito: sin membresía, sin cuenta
 * elegida, MFA OBLIGATORIO (sin MFA enrolado no hay token) y apagado por el interruptor externo `PLATFORM_ACCESS_ENABLED`.
 * El token que da NO sirve para ninguna ruta de empresa (no tiene cuenta) y sus únicos permisos son los `platform:*`.
 */
@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly token: TokenService,
  ) {}

  private invalid(): UnauthorizedException {
    return new UnauthorizedException({ code: 'PLATFORM_AUTH_INVALID', message: 'Credenciales inválidas' });
  }

  private async verifyPassword(email: string, password: string) {
    const user = await this.prisma.platformUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await compare(password, user?.passwordHash ?? (await dummy()));
    if (!user || !user.isActive || !ok) throw this.invalid();
    return user;
  }

  private tokenFor(userId: string): string {
    return this.token.signAccess({
      sub: userId,
      accountId: '',
      roleId: 'platform',
      permissions: [...PLATFORM_PERMISSIONS],
      sessionId: `platform:${randomUUID()}`,
      av: 0,
      pv: 0,
      actorType: 'PLATFORM',
    });
  }

  async login(email: string, password: string, code?: string): Promise<PlatformLoginResult> {
    if (!platformAccessEnabled()) throw new ForbiddenException({ code: 'PLATFORM_DISABLED', message: 'El acceso de plataforma está deshabilitado' });
    const user = await this.verifyPassword(email, password);

    if (!user.mfaEnabled) {
      // El MFA es obligatorio: la primera vez no hay token, hay un secreto para enrolar. Se reutiliza el pendiente si ya se había generado.
      const secret = user.mfaSecret ? this.crypto.decrypt(user.mfaSecret) : generateSecret();
      if (!user.mfaSecret) await this.prisma.platformUser.update({ where: { id: user.id }, data: { mfaSecret: this.crypto.encrypt(secret) } });
      return { step: 'mfa_setup', secret, otpauthUrl: otpauthUrl(user.email, secret) };
    }
    if (!code || !user.mfaSecret || !verifyTotp(this.crypto.decrypt(user.mfaSecret), code)) throw this.invalid();
    this.logger.warn(`Inicio de sesión de plataforma (${user.id})`);
    return { step: 'done', accessToken: this.tokenFor(user.id) };
  }

  /** Confirma el enrolamiento del MFA con un código del secreto pendiente; si coincide lo activa y entrega el token. */
  async confirmMfa(email: string, password: string, code: string): Promise<{ accessToken: string }> {
    if (!platformAccessEnabled()) throw new ForbiddenException({ code: 'PLATFORM_DISABLED', message: 'El acceso de plataforma está deshabilitado' });
    const user = await this.verifyPassword(email, password);
    if (user.mfaEnabled || !user.mfaSecret || !verifyTotp(this.crypto.decrypt(user.mfaSecret), code)) throw this.invalid();
    await this.prisma.platformUser.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    this.logger.warn(`MFA de plataforma enrolado (${user.id})`);
    return { accessToken: this.tokenFor(user.id) };
  }
}
