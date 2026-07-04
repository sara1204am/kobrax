import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Cifrado AES-256-GCM con IV aleatorio por registro.
 * Formato de salida: `ivB64.tagB64.cipherB64`.
 * Lo usa el MFA (mfa_secret) en F2a y los datos sensibles de cliente (PII) en F4.
 * Vive en `common/crypto` (módulo `@Global`) para ser inyectable desde cualquier módulo.
 */
@Injectable()
export class CryptoService {
  private cachedKey?: Buffer;

  constructor(private readonly config: AppConfigService) {}

  private get key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = this.config.encryptionKey;
    if (!raw) throw new Error('APP_ENCRYPTION_KEY no configurada (requerida para cifrado AES-256)');
    const buf = Buffer.from(raw, 'hex');
    if (buf.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY debe ser 32 bytes (64 caracteres hex)');
    }
    this.cachedKey = buf;
    return buf;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ctB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !ctB64) throw new Error('Formato de cifrado inválido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }
}
