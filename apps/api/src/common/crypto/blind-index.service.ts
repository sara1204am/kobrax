import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Blind index para buscar/deduplicar valores cifrados (p.ej. el documento del cliente)
 * SIN exponer el plaintext. `hash(value)` = HMAC-SHA256(normalize(value), APP_BLIND_INDEX_KEY)
 * en hex, determinista → permite `WHERE national_id_hash = ?` y unicidad por tenant.
 *
 * La clave DEBE ser distinta de APP_ENCRYPTION_KEY (defensa en profundidad). Se valida al
 * boot (`onModuleInit`) → fail-fast si falta o no mide 32 bytes.
 *
 * NB: la normalización es CONTRACTUAL. Cambiarla invalida todos los hashes ya almacenados.
 */
@Injectable()
export class BlindIndexService implements OnModuleInit {
  private cachedKey?: Buffer;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    void this.key; // fuerza la validación de la clave al arrancar (fail-fast)
  }

  private get key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = this.config.blindIndexKey;
    if (!raw) throw new Error('APP_BLIND_INDEX_KEY no configurada (requerida para el blind index de F4)');
    const buf = Buffer.from(raw, 'hex');
    if (buf.length !== 32) {
      throw new Error('APP_BLIND_INDEX_KEY debe ser 32 bytes (64 caracteres hex)');
    }
    this.cachedKey = buf;
    return buf;
  }

  /** Normalización canónica: trim → mayúsculas → quita espacios, puntos, guiones y barras. */
  normalize(value: string): string {
    return value.trim().toUpperCase().replace(/[\s.\-/]/g, '');
  }

  /** HMAC-SHA256 (hex) del valor normalizado. Devuelve null para valores vacíos. */
  hash(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = this.normalize(value);
    if (!normalized) return null;
    return createHmac('sha256', this.key).update(normalized).digest('hex');
  }
}
