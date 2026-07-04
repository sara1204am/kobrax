import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CryptoService } from './crypto.service';
import type { AppConfigService } from '../../config/app-config.service';

// Clave de 32 bytes (64 hex) solo para pruebas.
const config = {
  encryptionKey: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
} as unknown as AppConfigService;

const crypto = new CryptoService(config);

describe('CryptoService (AES-256-GCM)', () => {
  it('cifra y descifra (roundtrip)', () => {
    const plain = 'JBSWY3DPEHPK3PXP'; // estilo secreto MFA
    assert.equal(crypto.decrypt(crypto.encrypt(plain)), plain);
  });

  it('usa IV aleatorio por registro (cifrados distintos para el mismo texto)', () => {
    const a = crypto.encrypt('mismo-texto');
    const b = crypto.encrypt('mismo-texto');
    assert.notEqual(a, b);
    assert.equal(crypto.decrypt(a), crypto.decrypt(b));
  });

  it('el formato es iv.tag.ciphertext (3 partes base64)', () => {
    const parts = crypto.encrypt('x').split('.');
    assert.equal(parts.length, 3);
  });

  it('detecta manipulación del ciphertext (auth tag GCM)', () => {
    const enc = crypto.encrypt('secreto');
    const [iv, tag, ct] = enc.split('.');
    const tamperedCt = Buffer.from(ct!, 'base64');
    tamperedCt[0] = tamperedCt[0]! ^ 0xff; // flip de un bit
    const tampered = `${iv}.${tag}.${tamperedCt.toString('base64')}`;
    assert.throws(() => crypto.decrypt(tampered));
  });

  it('rechaza un formato inválido', () => {
    assert.throws(() => crypto.decrypt('no-es-un-payload-valido'));
  });
});
