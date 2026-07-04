import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecret, otpauthUrl, totpNow, verifyTotp } from './totp';

const STEP_MS = 30_000;

describe('totp (RFC-6238)', () => {
  it('genera un secreto base32 de longitud estable', () => {
    const s = generateSecret();
    assert.match(s, /^[A-Z2-7]+$/);
    assert.equal(s.length, 32); // 20 bytes → 32 chars base32 sin padding
  });

  it('un código recién generado se verifica', () => {
    const secret = generateSecret();
    const now = 1_700_000_000_000;
    const code = totpNow(secret, now);
    assert.match(code, /^\d{6}$/);
    assert.equal(verifyTotp(secret, code, 1, now), true);
  });

  it('acepta drift de ±1 ventana pero rechaza ±2', () => {
    const secret = generateSecret();
    const now = 1_700_000_000_000;
    const code = totpNow(secret, now);
    assert.equal(verifyTotp(secret, code, 1, now - STEP_MS), true); // -1 ventana
    assert.equal(verifyTotp(secret, code, 1, now + STEP_MS), true); // +1 ventana
    assert.equal(verifyTotp(secret, code, 1, now + 2 * STEP_MS), false); // +2 → fuera
  });

  it('rechaza un código de otro secreto', () => {
    const now = 1_700_000_000_000;
    const code = totpNow(generateSecret(), now);
    assert.equal(verifyTotp(generateSecret(), code, 1, now), false);
  });

  it('rechaza formatos inválidos', () => {
    const secret = generateSecret();
    const now = 1_700_000_000_000;
    assert.equal(verifyTotp(secret, '12345', 1, now), false); // 5 dígitos
    assert.equal(verifyTotp(secret, 'abcdef', 1, now), false); // no numérico
    assert.equal(verifyTotp(secret, '', 1, now), false);
  });

  it('es compatible con un vector TOTP conocido (secret "12345678901234567890" base32)', () => {
    // Secreto ASCII "12345678901234567890" → base32. Vector RFC-6238 (SHA1) en T=59s → 287082.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(totpNow(secret, 59_000), '287082');
    assert.equal(totpNow(secret, 1_111_111_109_000), '081804');
  });

  it('otpauthUrl arma la URI con issuer y parámetros estándar', () => {
    const url = otpauthUrl('user@kobrax.demo', 'ABCDEF', 'Kobrax');
    assert.ok(url.startsWith('otpauth://totp/Kobrax:user%40kobrax.demo?'));
    assert.match(url, /secret=ABCDEF/);
    assert.match(url, /algorithm=SHA1/);
    assert.match(url, /digits=6/);
    assert.match(url, /period=30/);
  });
});
