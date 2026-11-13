import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PLATFORM_PERMISSIONS } from '@kobrax/shared';
import type { PlatformUser } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TokenService } from '../auth/token.service';
import { generateSecret, otpauthUrl, totpNow } from '../auth/totp';
import { platformAccessEnabled } from './platform-switches';

export type PlatformLoginResult =
  | { step: 'done'; accessToken: string }
  /** Primer ingreso: el MFA es obligatorio y todavía no está enrolado. Se muestra el secreto una vez; se confirma con `mfa/confirm`. */
  | { step: 'mfa_setup'; secret: string; otpauthUrl: string };

/** Intentos fallidos seguidos que bloquean la cuenta de plataforma, y por cuánto. Sumado al límite por IP del controlador. */
export const PLATFORM_MAX_FAILED_ATTEMPTS = 5;
export const PLATFORM_LOCK_MS = 15 * 60_000;
/** Un código TOTP vale una ventana de 30 s; se aceptan la anterior, la actual y la siguiente (desfase de reloj). */
const TOTP_STEP_MS = 30_000;

/** Hash válido (mismo costo que los reales) de una contraseña que nadie conoce: se compara contra él cuando el correo no existe, para no filtrar por tiempo si existe. */
let dummyHash: Promise<string> | undefined;
const dummy = (): Promise<string> => (dummyHash ??= hash(randomUUID(), 12));

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * F14 · F5 (ADR-F14-08, H-11): el inicio de sesión de la persona de plataforma. Es aparte del de empresa a propósito: sin membresía, sin cuenta
 * elegida, MFA OBLIGATORIO (sin MFA enrolado no hay token) y apagado por el interruptor externo `PLATFORM_ACCESS_ENABLED`.
 * El token que da NO sirve para ninguna ruta de empresa (no tiene cuenta) y sus únicos permisos son los `platform:*`.
 *
 * Defensas, además del límite de peticiones por IP del controlador:
 *  · bloqueo de la cuenta tras 5 fallos seguidos (contraseña o código), 15 minutos; la respuesta es siempre la misma;
 *  · un código TOTP ya usado no vuelve a valer (se guarda el último tramo aceptado);
 *  · ENROLAR el MFA exige además la clave de enrolamiento que tiene quien opera el servidor (`PLATFORM_ENROLLMENT_KEY`): conocer la contraseña no
 *    alcanza para registrar el propio autenticador.
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

  private assertEnabled(): void {
    if (!platformAccessEnabled()) throw new ForbiddenException({ code: 'PLATFORM_DISABLED', message: 'El acceso de plataforma está deshabilitado' });
  }

  /** Cuenta un fallo; al llegar al tope bloquea. Siempre termina en la misma respuesta genérica. */
  private async fail(user: PlatformUser | null): Promise<never> {
    if (user) {
      const attempts = user.failedAttempts + 1;
      const lock = attempts >= PLATFORM_MAX_FAILED_ATTEMPTS;
      await this.prisma.platformUser.update({
        where: { id: user.id },
        data: { failedAttempts: lock ? 0 : attempts, ...(lock ? { lockedUntil: new Date(Date.now() + PLATFORM_LOCK_MS) } : {}) },
      });
      if (lock) this.logger.warn(`Cuenta de plataforma bloqueada por intentos fallidos (${user.id})`);
    }
    throw this.invalid();
  }

  private async verifyPassword(email: string, password: string): Promise<PlatformUser> {
    const user = await this.prisma.platformUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await compare(password, user?.passwordHash ?? (await dummy()));
    if (!user || !user.isActive) throw this.invalid();
    if (user.lockedUntil && user.lockedUntil > new Date()) throw this.invalid(); // bloqueada: misma respuesta, sin pistas
    if (!ok) return this.fail(user);
    return user;
  }

  /** ¿El código es válido y NO se usó ya? Devuelve el tramo aceptado (para guardarlo) o `null`. */
  private acceptedStep(secret: string, code: string, lastStep: bigint | null): number | null {
    const now = Math.floor(Date.now() / TOTP_STEP_MS);
    for (const step of [now, now - 1, now + 1]) {
      if (safeEqual(totpNow(secret, step * TOTP_STEP_MS), code)) return lastStep != null && BigInt(step) <= lastStep ? null : step;
    }
    return null;
  }

  private enrollmentAllowed(key: string | undefined): boolean {
    const expected = process.env.PLATFORM_ENROLLMENT_KEY;
    return Boolean(expected) && typeof key === 'string' && safeEqual(key, expected!);
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

  private async succeed(user: PlatformUser, step?: number): Promise<void> {
    await this.prisma.platformUser.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, ...(step != null ? { mfaLastStep: BigInt(step) } : {}) } });
  }

  async login(email: string, password: string, code?: string, enrollmentKey?: string): Promise<PlatformLoginResult> {
    this.assertEnabled();
    const user = await this.verifyPassword(email, password);

    if (!user.mfaEnabled) {
      // El MFA es obligatorio: la primera vez no hay token, hay un secreto para enrolar, y SÓLO si quien pregunta tiene la clave de enrolamiento.
      if (!this.enrollmentAllowed(enrollmentKey)) return this.fail(user);
      const secret = user.mfaSecret ? this.crypto.decrypt(user.mfaSecret) : generateSecret();
      if (!user.mfaSecret) await this.prisma.platformUser.update({ where: { id: user.id }, data: { mfaSecret: this.crypto.encrypt(secret) } });
      return { step: 'mfa_setup', secret, otpauthUrl: otpauthUrl(user.email, secret) };
    }
    const step = code && user.mfaSecret ? this.acceptedStep(this.crypto.decrypt(user.mfaSecret), code, user.mfaLastStep) : null;
    if (step == null) return this.fail(user);
    await this.succeed(user, step);
    this.logger.warn(`Inicio de sesión de plataforma (${user.id})`);
    return { step: 'done', accessToken: this.tokenFor(user.id) };
  }

  /** Confirma el enrolamiento del MFA con un código del secreto pendiente; si coincide lo activa y entrega el token. */
  async confirmMfa(email: string, password: string, code: string, enrollmentKey?: string): Promise<{ accessToken: string }> {
    this.assertEnabled();
    const user = await this.verifyPassword(email, password);
    if (user.mfaEnabled || !user.mfaSecret || !this.enrollmentAllowed(enrollmentKey)) return this.fail(user);
    const step = this.acceptedStep(this.crypto.decrypt(user.mfaSecret), code, user.mfaLastStep);
    if (step == null) return this.fail(user);
    await this.prisma.platformUser.update({ where: { id: user.id }, data: { mfaEnabled: true, failedAttempts: 0, lockedUntil: null, mfaLastStep: BigInt(step) } });
    this.logger.warn(`MFA de plataforma enrolado (${user.id})`);
    return { accessToken: this.tokenFor(user.id) };
  }
}
