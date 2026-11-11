import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthzVersionService, membershipKey, POLICY_VERSION_KEY } from './authz-version.service';

/** Redis en memoria con lo justo: MGET y el EVAL de «set si es mayor». */
function fakeRedis() {
  const store = new Map<string, string>();
  const state = { down: false };
  const guardDown = () => {
    if (state.down) throw new Error('redis caído');
  };
  return {
    store,
    state,
    mget: async (...keys: string[]) => {
      guardDown();
      return keys.map((k) => store.get(k) ?? null);
    },
    eval: async (_lua: string, _n: number, key: string, value: string) => {
      guardDown();
      const cur = store.get(key);
      if (cur === undefined || Number(value) > Number(cur)) store.set(key, value);
    },
  };
}

function makeService(opts: { dbVersion?: number | null; policy?: number } = {}) {
  const redis = fakeRedis();
  const outbox: { id: string; account_id: string; user_id: string; version: number; processed: boolean }[] = [];
  const marks: string[][] = [];
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('authz_membership_version')) return [{ v: opts.dbVersion === undefined ? 1 : opts.dbVersion }];
      if (sql.includes('authz_outbox_mark')) {
        const ids = vals[0] as string[];
        marks.push(ids);
        outbox.forEach((o) => ids.includes(o.id) && (o.processed = true));
        return [{}];
      }
      if (sql.includes('authz_outbox_pending')) return outbox.filter((o) => !o.processed);
      return [];
    },
    platformSetting: { findUnique: async () => ({ policyVersion: opts.policy ?? 1 }) },
  };
  const service = new AuthzVersionService(redis as never, prisma as never);
  return { service, redis, outbox, marks };
}

const claims = { sessionId: 's1', sub: 'u1', accountId: 'a1' };

describe('AuthzVersionService.check', () => {
  it('versiones al día → ok', async () => {
    const { service, redis } = makeService();
    redis.store.set(membershipKey('u1', 'a1'), '4');
    redis.store.set(POLICY_VERSION_KEY, '2');
    assert.equal(await service.check({ ...claims, av: 4, pv: 2 }), 'ok');
  });
  it('av distinto (rol/oficina cambiaron) → stale', async () => {
    const { service, redis } = makeService();
    redis.store.set(membershipKey('u1', 'a1'), '5');
    redis.store.set(POLICY_VERSION_KEY, '2');
    assert.equal(await service.check({ ...claims, av: 4, pv: 2 }), 'stale');
  });
  it('pv distinto (política global cambió) → stale', async () => {
    const { service, redis } = makeService();
    redis.store.set(membershipKey('u1', 'a1'), '4');
    redis.store.set(POLICY_VERSION_KEY, '3');
    assert.equal(await service.check({ ...claims, av: 4, pv: 2 }), 'stale');
  });
  it('token anterior a F1 (sin av/pv) → stale una vez', async () => {
    const { service } = makeService();
    assert.equal(await service.check({ ...claims }), 'stale');
  });
  it('sesión en la denylist → revoked', async () => {
    const { service, redis } = makeService();
    redis.store.set('revoked_session:s1', '1');
    assert.equal(await service.check({ ...claims, av: 1, pv: 1 }), 'revoked');
  });
  it('clave ausente en Redis → se lee de la DB y se vuelve a poner', async () => {
    const { service, redis } = makeService({ dbVersion: 6, policy: 3 });
    assert.equal(await service.check({ ...claims, av: 6, pv: 3 }), 'ok');
    assert.equal(redis.store.get(membershipKey('u1', 'a1')), '6');
    assert.equal(redis.store.get(POLICY_VERSION_KEY), '3');
  });
  it('la membresía ya no existe → stale (el refresh la rechazará)', async () => {
    const { service } = makeService({ dbVersion: null });
    assert.equal(await service.check({ ...claims, av: 1, pv: 1 }), 'stale');
  });
  it('🔴 Redis caído → lanza (el guard falla cerrado)', async () => {
    const { service, redis } = makeService();
    redis.state.down = true;
    await assert.rejects(service.check({ ...claims, av: 1, pv: 1 }));
  });
});

describe('AuthzVersionService.publish / reconcile', () => {
  const pending = { outboxId: 'o1', accountId: 'a1', userId: 'u1', version: 5 };
  it('publish escribe la versión y marca la outbox', async () => {
    const { service, redis, marks } = makeService();
    await service.publish([pending]);
    assert.equal(redis.store.get(membershipKey('u1', 'a1')), '5');
    assert.deepEqual(marks, [['o1']]);
  });
  it('nunca baja una versión: un llenado viejo no pisa un bump más reciente', async () => {
    const { service, redis } = makeService();
    redis.store.set(membershipKey('u1', 'a1'), '9');
    await service.publish([pending]);
    assert.equal(redis.store.get(membershipKey('u1', 'a1')), '9');
  });
  it('🔴 Redis falla en publish → no propaga y la fila queda pendiente; el reconciliador la vacía al volver', async () => {
    const { service, redis, outbox } = makeService();
    outbox.push({ id: 'o1', account_id: 'a1', user_id: 'u1', version: 5, processed: false });
    redis.state.down = true;
    await service.publish([pending]); // no lanza
    assert.equal(outbox[0]!.processed, false);
    assert.equal(await service.reconcile(), 0); // sigue caído: no pierde nada
    redis.state.down = false;
    assert.equal(await service.reconcile(), 1);
    assert.equal(redis.store.get(membershipKey('u1', 'a1')), '5');
    assert.equal(outbox[0]!.processed, true);
  });
});

describe('AuthzVersionService — la versión de política sube por migración', () => {
  it('reconcile lleva policy_version a Redis aunque no haya nada en la outbox (un token nuevo con pv=3 no puede quedar obsoleto)', async () => {
    const { service, redis } = makeService({ policy: 3 });
    redis.store.set(POLICY_VERSION_KEY, '2');
    await service.reconcile();
    assert.equal(redis.store.get(POLICY_VERSION_KEY), '3');
  });
  it('si Redis cae, sincronizar la política no rompe el ciclo', async () => {
    const { service, redis } = makeService({ policy: 3 });
    redis.state.down = true;
    assert.equal(await service.reconcile(), 0);
  });
});
