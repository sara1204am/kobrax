import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

/** Redis falso: emula el script atómico (INCR + EXPIRE si es el primero + TTL). */
class FakeRedis {
  counts = new Map<string, number>();
  evals = 0;
  async eval(_script: string, _n: number, key: string, windowSec: number | string) {
    this.evals++;
    const c = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, c);
    return [c, Number(windowSec)];
  }
}

function ctx(req: { method?: string; path: string; ip?: string; authorization?: string }): ExecutionContext {
  class Ctl {}
  const handler = function handler() {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: req.method ?? 'GET',
        path: req.path,
        ip: req.ip ?? '1.1.1.1',
        headers: req.authorization ? { authorization: req.authorization } : {},
        body: {},
      }),
    }),
    getClass: () => Ctl,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

const reflector = { get: () => undefined } as unknown as Reflector;
const make = () => {
  const redis = new FakeRedis();
  return { redis, guard: new RateLimitGuard(redis as never, reflector) };
};

describe('RateLimitGuard', () => {
  it('exime solo GET /api/health y /api/health/live exactos', async () => {
    const { guard, redis } = make();
    assert.equal(await guard.canActivate(ctx({ path: '/api/health' })), true);
    assert.equal(await guard.canActivate(ctx({ path: '/api/health/live' })), true);
    assert.equal(redis.evals, 0);
  });

  it('NO exime rutas que solo contienen "/health" ni métodos distintos de GET', async () => {
    const { guard, redis } = make();
    await guard.canActivate(ctx({ path: '/api/clients/health-check' }));
    await guard.canActivate(ctx({ path: '/api/health', method: 'POST' }));
    assert.ok(redis.evals > 0);
  });

  it('un Authorization inventado en cada petición no esquiva el límite por IP', async () => {
    const { guard } = make();
    let blocked = false;
    for (let i = 0; i < 6100 && !blocked; i++) {
      try {
        await guard.canActivate(ctx({ path: '/api/x', authorization: `Bearer a${i}.b${i}.c${i}` }));
      } catch (e) {
        blocked = (e as { getStatus: () => number }).getStatus() === 429;
      }
    }
    assert.equal(blocked, true);
  });

  it('un Authorization que no parece JWT cuenta como no autenticado (cubo por IP)', async () => {
    const { guard, redis } = make();
    await guard.canActivate(ctx({ path: '/api/x', authorization: 'basura' }));
    await guard.canActivate(ctx({ path: '/api/x', authorization: 'otra-basura' }));
    assert.equal(redis.counts.get('rl:global:ip:1.1.1.1'), 2);
  });

  it('un Bearer con forma de JWT sí tiene cubo propio', async () => {
    const { guard, redis } = make();
    await guard.canActivate(ctx({ path: '/api/x', authorization: 'Bearer aaa.bbb.ccc' }));
    assert.ok([...redis.counts.keys()].some((k) => k.startsWith('rl:global:t:')));
  });

  it('responde 429 al exceder el límite global', async () => {
    const { guard } = make();
    let status = 0;
    for (let i = 0; i < 601 && !status; i++) {
      try {
        await guard.canActivate(ctx({ path: '/api/x' }));
      } catch (e) {
        status = (e as { getStatus: () => number }).getStatus();
      }
    }
    assert.equal(status, 429);
  });
});
