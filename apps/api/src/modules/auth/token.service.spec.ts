import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import type { AppConfigService } from '../../config/app-config.service';

/** Config mínima de pruebas (solo lo que usa TokenService). */
const config = {
  jwtSecret: 'test-access-secret-0123456789',
  jwtRefreshSecret: 'test-refresh-secret-0123456789',
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
} as unknown as AppConfigService;

const token = new TokenService(new JwtService({}), config);

describe('TokenService', () => {
  it('access token: verifyAccess devuelve los claims', () => {
    const jwt = token.signAccess({
      sub: 'u1',
      accountId: 'a1',
      roleId: 'r1',
      permissions: ['case:read'],
      sessionId: 's1',
    });
    const claims = token.verifyAccess(jwt);
    assert.equal(claims.sub, 'u1');
    assert.equal(claims.accountId, 'a1');
    assert.deepEqual(claims.permissions, ['case:read']);
  });

  it('un pre-auth token NO se acepta como access (type distinto)', () => {
    const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa' });
    assert.throws(() => token.verifyAccess(pre));
  });

  it('verifyPreAuth exige el propósito esperado', () => {
    const pre = token.signPreAuth({ sub: 'u1', purpose: 'mfa' });
    const ok = token.verifyPreAuth(pre, 'mfa');
    assert.equal(ok.sub, 'u1');
    assert.equal(ok.purpose, 'mfa');
    assert.throws(() => token.verifyPreAuth(pre, 'select_account'));
  });

  it('un access token NO se acepta como pre-auth', () => {
    const acc = token.signAccess({
      sub: 'u1',
      accountId: 'a1',
      roleId: 'r1',
      permissions: [],
      sessionId: 's1',
    });
    assert.throws(() => token.verifyPreAuth(acc, 'mfa'));
  });

  it('refresh token: verifyRefresh devuelve claims y el hash coincide con hash(jti)', () => {
    const { token: rt, jti, hash } = token.signRefresh({
      sub: 'u1',
      accountId: 'a1',
      sessionId: 's1',
      familyId: 'f1',
    });
    const claims = token.verifyRefresh(rt);
    assert.equal(claims.type, 'refresh');
    assert.equal(claims.jti, jti);
    assert.equal(token.hash(jti), hash);
  });

  it('un access token firmado con el secret de acceso no pasa verifyRefresh (otro secret)', () => {
    const acc = token.signAccess({
      sub: 'u1',
      accountId: 'a1',
      roleId: 'r1',
      permissions: [],
      sessionId: 's1',
    });
    assert.throws(() => token.verifyRefresh(acc));
  });
});
