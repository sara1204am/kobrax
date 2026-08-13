/**
 * PII cifrada y con su blind index, **igual que la API**.
 *
 * Sembrar el documento en claro no es un atajo inocuo: al leerlo, `CryptoService` intenta
 * descifrarlo y la ficha del cliente revienta. Por eso todos los seeds pasan por acá.
 *
 * Vive suelto porque lo usan los tres (`seed`, `seed-day`, `seed-bulk`) y una tercera copia del
 * mismo algoritmo es una copia que se va a desincronizar de la API sin que nadie lo note.
 */
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

/** Las claves se leen en cada llamada: `process.env` ya está poblado al instanciar Prisma. */
function encKey(): Buffer {
  const k = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? '', 'hex');
  if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY (32 bytes hex) requerida para sembrar PII cifrada');
  return k;
}

function blindKey(): Buffer {
  const k = Buffer.from(process.env.APP_BLIND_INDEX_KEY ?? '', 'hex');
  if (k.length !== 32) throw new Error('APP_BLIND_INDEX_KEY (32 bytes hex) requerida para el blind index');
  return k;
}

/** Cifra a `iv.tag.ct`, el mismo formato que `CryptoService`. */
export function encryptPII(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

/** Blind index determinista, con la misma normalización que `BlindIndexService`. */
export function blindHash(value: string): string {
  const norm = value.trim().toUpperCase().replace(/[\s.\-/]/g, '');
  return createHmac('sha256', blindKey()).update(norm).digest('hex');
}
