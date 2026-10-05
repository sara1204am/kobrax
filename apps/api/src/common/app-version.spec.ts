import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { compareAppVersions, isBelowMinVersion, parseAppVersion } from './app-version';
import { AppVersionGuard } from './guards/app-version.guard';

describe('parseAppVersion / compareAppVersions', () => {
  it('lee semver, con prefijo v, parcial y con sufijos', () => {
    assert.deepEqual(parseAppVersion('1.4.2'), [1, 4, 2]);
    assert.deepEqual(parseAppVersion('v1.4'), [1, 4, 0]);
    assert.deepEqual(parseAppVersion('2'), [2, 0, 0]);
    assert.deepEqual(parseAppVersion('1.4.2-beta.1'), [1, 4, 2]);
    assert.deepEqual(parseAppVersion('1.4.2+build7'), [1, 4, 2]);
  });

  it('basura o vacío → null', () => {
    for (const v of ['', 'abc', '1.x', '1..2', undefined, null]) assert.equal(parseAppVersion(v as never), null);
  });

  it('compara numéricamente, no como texto (1.10 > 1.9)', () => {
    assert.ok(compareAppVersions('1.10.0', '1.9.0')! > 0);
    assert.ok(compareAppVersions('1.2.3', '1.2.4')! < 0);
    assert.equal(compareAppVersions('1.2', '1.2.0'), 0);
    assert.equal(compareAppVersions('x', '1.0.0'), null);
  });

  it('isBelowMinVersion: sólo true si ambas se leen y la del cliente es menor', () => {
    assert.equal(isBelowMinVersion('1.0.0', '1.2.0'), true);
    assert.equal(isBelowMinVersion('1.2.0', '1.2.0'), false);
    assert.equal(isBelowMinVersion('2.0.0', '1.2.0'), false);
    assert.equal(isBelowMinVersion(undefined, '1.2.0'), false);
    assert.equal(isBelowMinVersion('1.0.0', undefined), false);
    assert.equal(isBelowMinVersion('basura', '1.2.0'), false);
    assert.equal(isBelowMinVersion('1.0.0', 'basura'), false);
  });
});

describe('AppVersionGuard', () => {
  const original = process.env.MIN_APP_VERSION;
  afterEach(() => {
    if (original === undefined) delete process.env.MIN_APP_VERSION;
    else process.env.MIN_APP_VERSION = original;
  });

  const ctx = (path: string, version?: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ path, headers: version === undefined ? {} : { 'x-app-version': version } }) }) }) as never;
  const guard = new AppVersionGuard();

  it('sin MIN_APP_VERSION deja pasar todo (comportamiento por defecto)', () => {
    delete process.env.MIN_APP_VERSION;
    assert.equal(guard.canActivate(ctx('/api/mora', '0.0.1')), true);
  });

  it('sin header deja pasar (panel web, clientes que no lo mandan)', () => {
    process.env.MIN_APP_VERSION = '1.2.0';
    assert.equal(guard.canActivate(ctx('/api/mora')), true);
  });

  it('versión igual o mayor pasa', () => {
    process.env.MIN_APP_VERSION = '1.2.0';
    assert.equal(guard.canActivate(ctx('/api/mora', '1.2.0')), true);
    assert.equal(guard.canActivate(ctx('/api/mora', '1.10.0')), true);
  });

  it('versión menor → 426 con code APP_001 y mensaje en español', () => {
    process.env.MIN_APP_VERSION = '1.2.0';
    assert.throws(
      () => guard.canActivate(ctx('/api/mora', '1.1.9')),
      (e: HttpException) => {
        const body = e.getResponse() as { code: string; message: string };
        assert.equal(e.getStatus(), 426);
        assert.equal(body.code, 'APP_001');
        assert.match(body.message, /Actualizá/);
        return true;
      },
    );
  });

  it('auth y health quedan fuera del corte', () => {
    process.env.MIN_APP_VERSION = '1.2.0';
    for (const p of ['/api/auth/login', '/api/auth/refresh', '/api/health']) assert.equal(guard.canActivate(ctx(p, '1.0.0')), true, p);
  });
});
