import { Injectable } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { generateSecret, otpauthUrl, verifyTotp } from './totp';
import { mfaInvalid, mfaNotEnrolled } from './auth.errors';

/** Cantidad de códigos de respaldo emitidos al activar MFA. */
const BACKUP_CODES = 8;

export interface EnrollResult {
  /** URL `otpauth://` para el QR. */
  otpauthUrl: string;
  /** Clave en base32 (entrada manual si no se escanea el QR). */
  secret: string;
}

/**
 * MFA TOTP (RFC-6238). El `mfa_secret` se guarda **cifrado** (AES-256-GCM vía
 * CryptoService) y nunca se expone tras el enroll. Los backup codes se guardan
 * **hasheados** (SHA-256) en `mfa_backup_codes` (tabla global, sin RLS) y son de
 * un solo uso.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** SHA-256 hex — lo que se persiste de un backup code (nunca el código en claro). */
  private hashCode(code: string): string {
    return createHash('sha256').update(this.normalize(code)).digest('hex');
  }

  /** Normaliza un backup code: sin separadores ni mayúsculas. */
  private normalize(code: string): string {
    return code.replace(/[\s-]/g, '').toLowerCase();
  }

  /** Genera `BACKUP_CODES` códigos legibles tipo `a1b2c-d3e4f`. */
  private generateBackupCodes(): string[] {
    return Array.from({ length: BACKUP_CODES }, () => {
      const raw = randomBytes(5).toString('hex'); // 10 hex chars
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
  }

  /**
   * Inicia el enroll: genera y guarda el secreto cifrado, pero **no activa** MFA
   * (eso ocurre en `verify`, tras confirmar un código válido).
   */
  async enroll(userId: string): Promise<EnrollResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw mfaNotEnrolled();
    const secret = generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: this.crypto.encrypt(secret) },
    });
    return { otpauthUrl: otpauthUrl(user.email, secret), secret };
  }

  /**
   * Confirma el enroll con un código TOTP. Si es válido: activa MFA y emite los
   * backup codes (reemplaza los anteriores). Devuelve los códigos en claro **una
   * sola vez** para que el usuario los guarde.
   */
  async verify(userId: string, code: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecret) throw mfaNotEnrolled();
    if (!verifyTotp(this.crypto.decrypt(user.mfaSecret), code)) throw mfaInvalid();

    const codes = this.generateBackupCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } }),
      this.prisma.mfaBackupCode.deleteMany({ where: { userId } }),
      this.prisma.mfaBackupCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: this.hashCode(c) })),
      }),
    ]);
    return codes;
  }

  /**
   * Valida un código durante el login (paso MFA): primero TOTP, luego backup code
   * de un solo uso. Devuelve `true`/`false` (el caller decide el error genérico).
   */
  async challenge(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled || !user.mfaSecret) return false;
    if (verifyTotp(this.crypto.decrypt(user.mfaSecret), code)) return true;
    return this.consumeBackupCode(userId, code);
  }

  /**
   * Deshabilita MFA (F2b) tras **re-autenticación**: password actual O un código
   * MFA vigente (TOTP o backup). Borra el secreto y los backup codes. Idempotente.
   */
  async disable(userId: string, opts: { password?: string; code?: string }): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled) return; // ya estaba deshabilitado

    const reauthed = opts.password
      ? await compare(opts.password, user.passwordHash)
      : opts.code
        ? await this.challenge(userId, opts.code)
        : false;
    if (!reauthed) throw mfaInvalid();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null },
      }),
      this.prisma.mfaBackupCode.deleteMany({ where: { userId } }),
    ]);
  }

  /** Regenera los 8 backup codes (invalida los anteriores). Requiere MFA activo. */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled) throw mfaNotEnrolled();

    const codes = this.generateBackupCodes();
    await this.prisma.$transaction([
      this.prisma.mfaBackupCode.deleteMany({ where: { userId } }),
      this.prisma.mfaBackupCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: this.hashCode(c) })),
      }),
    ]);
    return codes;
  }

  /** Consume un backup code (single-use) de forma atómica. */
  private async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const codeHash = this.hashCode(code);
    const match = await this.prisma.mfaBackupCode.findFirst({
      where: { userId, codeHash, usedAt: null },
    });
    if (!match) return false;
    // CAS: solo lo marca quien gane la carrera (un único uso real).
    const res = await this.prisma.mfaBackupCode.updateMany({
      where: { id: match.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return res.count === 1;
  }
}
