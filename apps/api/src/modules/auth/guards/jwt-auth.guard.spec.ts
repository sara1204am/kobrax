import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AUTH_ERR } from '../auth.errors';
import type { AuthzCheck } from '../authz-version.service';

/** F14 · F1 (H-2): el guard traduce el veredicto de versiones en 401 y falla cerrado si Redis no responde. */
function run(opts: { verdict?: AuthzCheck; redisDown?: boolean; check?: boolean; revoked?: boolean; claims?: Record<string, unknown> }) {
  const claims = { sub: 'u1', accountId: 'a1', roleId: 'r1', permissions: ['x'], sessionId: 's1', av: 1, pv: 1, ...opts.claims };
  const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer t' } };
  const guard = new JwtAuthGuard(
    { verifyAccess: () => claims } as never,
    { isRevoked: async () => opts.revoked ?? false } as never,
    {
      check: async () => {
        if (opts.redisDown) throw new Error('ECONNREFUSED');
        return opts.verdict ?? 'ok';
      },
    } as never,
    { authzVersionCheck: opts.check ?? true } as never,
  );
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { promise: guard.canActivate(ctx), req };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return ((e as { getResponse?: () => { code?: string } }).getResponse?.() ?? {}).code;
  }
}

describe('JwtAuthGuard — versiones de autorización (F14 · F1)', () => {
  it('versiones al día → pasa y adjunta av/pv', async () => {
    const { promise, req } = run({});
    assert.equal(await promise, true);
    assert.deepEqual({ av: (req.user as { av: number }).av, pv: (req.user as { pv: number }).pv }, { av: 1, pv: 1 });
  });
  it('av o pv viejos (o token sin ellos) → 401 AUTHZ_STALE', async () => {
    assert.equal(await codeOf(run({ verdict: 'stale' }).promise), AUTH_ERR.AUTHZ_STALE);
  });
  it('sesión revocada → 401 AUTH_003, no AUTHZ_STALE (no se reintenta)', async () => {
    assert.equal(await codeOf(run({ verdict: 'revoked' }).promise), AUTH_ERR.INVALID_TOKEN);
  });
  it('🔴 Redis caído → 401 AUTHZ_UNAVAILABLE (falla cerrado, sin bucle de renovación)', async () => {
    assert.equal(await codeOf(run({ redisDown: true }).promise), AUTH_ERR.AUTHZ_UNAVAILABLE);
  });
  it('flag off → como antes: sólo la denylist de sesión, aunque las versiones no coincidan', async () => {
    assert.equal(await run({ check: false, verdict: 'stale' }).promise, true);
    assert.equal(await codeOf(run({ check: false, revoked: true }).promise), AUTH_ERR.INVALID_TOKEN);
  });
});
