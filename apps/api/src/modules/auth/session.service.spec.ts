import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionService } from './session.service';

/** Fila cruda que devuelve la función SECURITY DEFINER `auth_user_sessions`. */
function row(sessionId: string, accountId: string) {
  return {
    session_id: sessionId,
    account_id: accountId,
    account_name: `Acc ${accountId}`,
    ip_address: '1.2.3.4',
    device_name: 'Pixel',
    device_type: 'mobile',
    os: 'Android',
    city: null,
    country: null,
    login_at: new Date(),
    last_seen_at: new Date(),
    expires_at: new Date(Date.now() + 1000),
  };
}

function makeDeps(rows: ReturnType<typeof row>[]) {
  const store = new Set<string>();
  const calls = { withTenant: [] as string[] };
  const redis = {
    set: async (key: string) => {
      store.add(key);
    },
    exists: async (key: string) => (store.has(key) ? 1 : 0),
  };
  const tx = {
    refreshToken: { updateMany: async () => ({ count: 1 }) },
    userSession: { updateMany: async () => ({ count: 1 }) },
  };
  const prisma = {
    $queryRaw: async () => rows,
    withTenant: async (accountId: string, cb: (t: typeof tx) => Promise<unknown>) => {
      calls.withTenant.push(accountId);
      return cb(tx);
    },
  };
  const service = new SessionService(redis as never, prisma as never);
  return { service, calls, store };
}

describe('SessionService denylist', () => {
  it('denylist + isRevoked hacen roundtrip por sessionId', async () => {
    const { service } = makeDeps([]);
    assert.equal(await service.isRevoked('s1'), false);
    await service.denylist('s1');
    assert.equal(await service.isRevoked('s1'), true);
  });
});

describe('SessionService.list', () => {
  it('marca isCurrent solo en la sesión consultada', async () => {
    const { service } = makeDeps([row('s1', 'a1'), row('s2', 'a1')]);
    const list = await service.list('u1', 's2');
    assert.equal(list.find((s) => s.id === 's1')!.isCurrent, false);
    assert.equal(list.find((s) => s.id === 's2')!.isCurrent, true);
  });
});

describe('SessionService.revokeOne', () => {
  it('es idempotente: no toca DB ni denylist si la sesión no pertenece al usuario', async () => {
    const { service, calls, store } = makeDeps([row('s1', 'a1')]);
    await service.revokeOne('u1', 'ajena');
    assert.equal(calls.withTenant.length, 0);
    assert.equal(store.size, 0);
  });

  it('revoca en el tenant correcto y añade a la denylist (efecto inmediato)', async () => {
    const { service, calls } = makeDeps([row('s1', 'a1')]);
    await service.revokeOne('u1', 's1');
    assert.deepEqual(calls.withTenant, ['a1']); // RLS del tenant dueño de la sesión
    assert.equal(await service.isRevoked('s1'), true);
  });
});

describe('SessionService.revokeAll', () => {
  it('revoca todas menos la actual y las añade a la denylist', async () => {
    const { service, calls } = makeDeps([row('s1', 'a1'), row('s2', 'a2'), row('s3', 'a1')]);
    const count = await service.revokeAll('u1', 's2');
    assert.equal(count, 2); // s1 y s3, no s2 (la actual)
    assert.deepEqual(calls.withTenant.sort(), ['a1', 'a1']);
    assert.equal(await service.isRevoked('s1'), true);
    assert.equal(await service.isRevoked('s3'), true);
    assert.equal(await service.isRevoked('s2'), false); // la actual sigue viva
  });

  it('sin excepción revoca absolutamente todas', async () => {
    const { service } = makeDeps([row('s1', 'a1'), row('s2', 'a2')]);
    const count = await service.revokeAll('u1');
    assert.equal(count, 2);
    assert.equal(await service.isRevoked('s1'), true);
    assert.equal(await service.isRevoked('s2'), true);
  });
});
