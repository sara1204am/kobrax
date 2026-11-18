import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvidence, isCovered, latestByPurpose, pickCurrent, requiredFloor, sha256Hex } from './legal.logic';

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

describe('re-aceptación (piso material)', () => {
  const v = (id: string, eff: string, isMaterial: boolean) => ({ id, effectiveAt: d(eff), isMaterial });
  const now = d('2026-11-16');

  it('el piso es la versión material más reciente que ya rige; si ninguna es material, la más antigua', () => {
    const v1 = v('v1', '2026-01-01', true);
    const v2 = v('v2', '2026-03-01', false);
    const v3 = v('v3', '2026-06-01', true);
    const v4 = v('v4', '2026-09-01', false);
    assert.equal(requiredFloor([v1, v2, v3, v4], now)?.id, 'v3');
    assert.equal(requiredFloor([v2, v4], now)?.id, 'v2');
    assert.equal(requiredFloor([], now), undefined);
  });

  it('una versión futura no cuenta todavía', () => {
    assert.equal(requiredFloor([v('v1', '2026-01-01', true), v('v9', '2027-01-01', true)], now)?.id, 'v1');
    assert.equal(requiredFloor([v('v9', '2027-01-01', true)], now), undefined);
  });

  it('🔴 un cambio editorial NO obliga a aceptar de nuevo; uno material SÍ', () => {
    const v1 = v('v1', '2026-01-01', true);
    const editorial = v('v1.1', '2026-05-01', false);
    // Aceptó v1; se publica una corrección editorial: sigue al día.
    assert.equal(isCovered(requiredFloor([v1, editorial], now)!, [v1]), true);
    // Después se publica un cambio material: ya no está al día.
    const material = v('v2', '2026-08-01', true);
    assert.equal(isCovered(requiredFloor([v1, editorial, material], now)!, [v1]), false);
    // Al aceptar la vigente queda al día.
    assert.equal(isCovered(requiredFloor([v1, editorial, material], now)!, [v1, material]), true);
  });

  it('quien nunca aceptó nada queda siempre pendiente', () => {
    assert.equal(isCovered(requiredFloor([v('v1', '2026-01-01', false)], now)!, []), false);
  });

  it('latestByPurpose lee el último estado de cada finalidad sin reescribir el historial', () => {
    const rows = [
      { purpose: 'MARKETING', status: 'GRANTED', recordedAt: d('2026-01-01') },
      { purpose: 'MARKETING', status: 'WITHDRAWN', recordedAt: d('2026-02-01') },
      { purpose: 'ANALYTICS', status: 'GRANTED', recordedAt: d('2026-01-15') },
    ];
    const m = latestByPurpose(rows);
    assert.equal(m.get('MARKETING')?.status, 'WITHDRAWN');
    assert.equal(m.get('ANALYTICS')?.status, 'GRANTED');
    assert.equal(m.get('COOKIES_NON_ESSENTIAL'), undefined);
  });
});
