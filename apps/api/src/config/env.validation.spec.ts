import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateEnv } from './env.validation';

const base = {
  APP_DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'change-me-access-secret',
  JWT_REFRESH_SECRET: 'change-me-refresh-secret',
};
const prod = {
  ...base,
  NODE_ENV: 'production',
  JWT_SECRET: 'k9Qe7Vx2Lm4Zp8Rt1Ys6Hd3Nb5Wc0Af',
  JWT_REFRESH_SECRET: 'Tz3Xr8Gj5Pv1Mq7Ub4Ke9Ci2Lw6Yo0Sd',
  APP_ENCRYPTION_KEY: 'a'.repeat(64),
  APP_BLIND_INDEX_KEY: 'b'.repeat(64),
};

describe('validateEnv — producción (S-4)', () => {
  it('desarrollo acepta los secretos de ejemplo', () => {
    assert.doesNotThrow(() => validateEnv({ ...base, NODE_ENV: 'development' }));
  });
  it('producción válida pasa', () => {
    assert.doesNotThrow(() => validateEnv(prod));
  });
  it('rechaza secretos de ejemplo', () => {
    assert.throws(() => validateEnv({ ...prod, JWT_SECRET: 'change-me-access-secret' }), /secreto de ejemplo/);
  });
  it('rechaza JWT_SECRET == JWT_REFRESH_SECRET', () => {
    assert.throws(() => validateEnv({ ...prod, JWT_REFRESH_SECRET: prod.JWT_SECRET }), /distinto de JWT_SECRET/);
  });
  it('exige las claves de cifrado', () => {
    assert.throws(() => validateEnv({ ...prod, APP_ENCRYPTION_KEY: undefined }), /APP_ENCRYPTION_KEY/);
    assert.throws(() => validateEnv({ ...prod, APP_BLIND_INDEX_KEY: '' }), /APP_BLIND_INDEX_KEY/);
  });
  it('FILE_LINK_SECRET no puede repetir el del JWT', () => {
    assert.throws(() => validateEnv({ ...prod, FILE_LINK_SECRET: prod.JWT_SECRET }), /FILE_LINK_SECRET/);
  });
});
