import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP RFC-6238 (sobre HOTP RFC-4226) implementado solo con `node:crypto`.
 * Parámetros estándar compatibles con Google Authenticator / Authy:
 * SHA-1, 6 dígitos, ventana de 30 s. Secreto en base32 (RFC-4648, sin padding).
 *
 * Nota: evitamos dependencias externas (otplib/speakeasy) por la regla de
 * "zero dependencias pesadas" del proyecto.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20; // 160 bits, recomendado por RFC-4226
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Codifica un Buffer a base32 (RFC-4648, sin padding). */
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decodifica base32 (ignora separadores y padding). */
function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC-4226): truncamiento dinámico del HMAC-SHA1. */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** Genera un secreto MFA nuevo (base32). */
export function generateSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** Código TOTP vigente para un secreto (usado en tests/verificación manual). */
export function totpNow(secretBase32: string, nowMs = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Verifica un código TOTP con tolerancia de ±`window` pasos (clock drift).
 * Comparación en tiempo constante para no filtrar por timing.
 */
export function verifyTotp(secretBase32: string, code: string, window = 1, nowMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  const target = Buffer.from(code);
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(secret, counter + i));
    if (candidate.length === target.length && timingSafeEqual(candidate, target)) return true;
  }
  return false;
}

/** URL `otpauth://` para generar el QR (issuer + label = email del usuario). */
export function otpauthUrl(label: string, secretBase32: string, issuer = 'Kobrax'): string {
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}
