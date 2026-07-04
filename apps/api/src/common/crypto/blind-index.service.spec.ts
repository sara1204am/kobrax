import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BlindIndexService } from './blind-index.service';
import type { AppConfigService } from '../../config/app-config.service';

const config = {
  blindIndexKey: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
} as unknown as AppConfigService;

const blind = new BlindIndexService(config);

describe('BlindIndexService', () => {
  it('hash determinista (mismo valor → mismo hash hex)', () => {
    assert.equal(blind.hash('CI-12345'), blind.hash('CI-12345'));
    assert.match(blind.hash('CI-12345')!, /^[a-f0-9]{64}$/);
  });

  it('normaliza: "CI-12345", "ci 12345" y "12345" con prefijo igual colisionan tras normalizar', () => {
    // normalize quita separadores y sube a mayúsculas → mismas variantes = mismo hash
    assert.equal(blind.hash('CI-12345'), blind.hash('ci 12.345'));
    assert.equal(blind.hash('ci/12345'), blind.hash('CI 12345'));
  });

  it('valores distintos → hashes distintos', () => {
    assert.notEqual(blind.hash('12345'), blind.hash('12346'));
  });

  it('valores vacíos → null (no se indexa)', () => {
    assert.equal(blind.hash(''), null);
    assert.equal(blind.hash(null), null);
    assert.equal(blind.hash('   '), null);
  });

  it('rechaza una clave que no mide 32 bytes', () => {
    const bad = new BlindIndexService({ blindIndexKey: 'abcd' } as unknown as AppConfigService);
    assert.throws(() => bad.hash('x'));
  });
});
