import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvidence, pickCurrent, sha256Hex } from './legal.logic';

const d = (iso: string) => new Date(iso);

describe('legal.logic', () => {
  it('sha256Hex es el SHA-256 hex del UTF-8 (valor conocido) y cambia con cualquier carácter', () => {
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.notEqual(sha256Hex('Términos v1'), sha256Hex('Términos v1.'));
    // Los acentos cuentan como UTF-8, no como latin1.
    assert.equal(sha256Hex('ñ'), sha256Hex(Buffer.from('ñ', 'utf8').toString('utf8')));
  });

  it('pickCurrent elige la versión que ya rige más reciente, ignora las futuras y desempata por publicación', () => {
    const v1 = { id: 'v1', effectiveAt: d('2026-01-01'), publishedAt: d('2026-01-01') };
    const v2 = { id: 'v2', effectiveAt: d('2026-06-01'), publishedAt: d('2026-05-01') };
    const futura = { id: 'v3', effectiveAt: d('2027-01-01'), publishedAt: d('2026-07-01') };
    const now = d('2026-11-16');
    assert.equal(pickCurrent([v1, v2, futura], now)?.id, 'v2');
    assert.equal(pickCurrent([futura], now), undefined);
    const mismoDia = { id: 'v2b', effectiveAt: d('2026-06-01'), publishedAt: d('2026-05-02') };
    assert.equal(pickCurrent([v2, mismoDia], now)?.id, 'v2b');
  });

  it('cleanEvidence recorta el user-agent, deja null lo vacío y no inventa datos', () => {
    const e = cleanEvidence({ ip: ' 203.0.113.9 ', userAgent: 'x'.repeat(500), appVersion: '' });
    assert.equal(e.ip, '203.0.113.9');
    assert.equal(e.userAgent?.length, 300);
    assert.equal(e.appVersion, null);
    assert.deepEqual(cleanEvidence({}), { ip: null, userAgent: null, appVersion: null });
  });
});
