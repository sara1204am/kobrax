import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGps, sha256OfBase64, verifyEvidenceHash } from './field-integrity';

describe('isValidGps', () => {
  it('acepta coordenadas válidas y rechaza fuera de rango / NaN', () => {
    assert.equal(isValidGps(-16.5, -68.15), true);
    assert.equal(isValidGps(0, 0), true);
    assert.equal(isValidGps(91, 0), false);
    assert.equal(isValidGps(0, 181), false);
    assert.equal(isValidGps(Number.NaN, 0), false);
  });
});

describe('sha256OfBase64 / verifyEvidenceHash', () => {
  // base64('hello') = 'aGVsbG8=' ; sha256('hello') conocido
  const HELLO_B64 = Buffer.from('hello').toString('base64');
  const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  it('calcula el SHA-256 del buffer original', () => {
    assert.equal(sha256OfBase64(HELLO_B64), HELLO_SHA);
  });

  it('verifica integridad (coincide / no coincide, case-insensitive)', () => {
    assert.equal(verifyEvidenceHash(HELLO_B64, HELLO_SHA), true);
    assert.equal(verifyEvidenceHash(HELLO_B64, HELLO_SHA.toUpperCase()), true);
    assert.equal(verifyEvidenceHash(HELLO_B64, 'deadbeef'), false);
    assert.equal(verifyEvidenceHash(Buffer.from('otro').toString('base64'), HELLO_SHA), false);
  });
});
