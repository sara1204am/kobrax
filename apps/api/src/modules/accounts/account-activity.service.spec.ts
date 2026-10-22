import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountActivityService } from './account-activity.service';

type Row = Record<string, unknown>;

function log(id: string, over: Row = {}): Row {
  return {
    id,
    accountId: 'acc-A',
    userId: 'u1',
    action: 'UPDATE',
    entity: 'account',
    entityId: 'acc-A',
    before: { city: 'La Paz' },
    after: { city: 'Sucre' },
    ip: '10.0.0.1',
    createdAt: new Date('2026-10-21T12:00:00Z'),
    ...over,
  };
}

function makeService(rows: Row[] = []) {
  const calls = { where: undefined as Row | undefined, take: undefined as number | undefined };
  const tx = {
    auditLog: {
      findMany: async (args: { where: Row; take: number }) => {
        calls.where = args.where;
        calls.take = args.take;
        return rows;
      },
    },
    user: { findMany: async () => [{ id: 'u1', email: 'sara@kobrax.demo', profile: { firstName: 'Sara', lastName: 'Admin' } }] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { service: new AccountActivityService(prisma as never, { accountId: 'acc-A' } as never), calls };
}

describe('AccountActivityService.activity', () => {
  it('lee sólo las entidades de la cuenta, de esta cuenta', async () => {
    const { service, calls } = makeService();
    await service.activity({});
    assert.equal(calls.where!.accountId, 'acc-A');
    assert.deepEqual((calls.where!.entity as { in: string[] }).in.sort(), ['account', 'account_request', 'arrear_category', 'branch', 'catalog_item', 'user_account']);
  });

  it('🔴 un `entity` fuera de la lista se ignora: no abre el registro entero (pagos, clientes…)', async () => {
    const { service, calls } = makeService();
    await service.activity({ entity: 'payment' });
    assert.ok((calls.where!.entity as { in: string[] }).in.length > 1);
    assert.ok(!(calls.where!.entity as { in: string[] }).in.includes('payment'));
  });

  it('un `entity` válido filtra a ese tipo', async () => {
    const { service, calls } = makeService();
    await service.activity({ entity: 'branch' });
    assert.deepEqual(calls.where!.entity, { in: ['branch'] });
  });

  it('filtra por persona cuando se pide', async () => {
    const { service, calls } = makeService();
    await service.activity({ userId: 'u9' });
    assert.equal(calls.where!.userId, 'u9');
  });

  it('un cursor válido agrega la condición «anterior a»; uno basura se ignora (primera página)', async () => {
    const id = '3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f11';
    const conCursor = makeService();
    await conCursor.service.activity({ before: `2026-10-21T12:00:00.000Z|${id}` });
    assert.ok('OR' in conCursor.calls.where!);

    const basura = makeService();
    await basura.service.activity({ before: 'cualquier-cosa' });
    assert.equal('OR' in basura.calls.where!, false);
  });

  it('pide una fila de más para saber si hay otra página, y arma el cursor con la última entregada', async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      log(`3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f0${i}`, { createdAt: new Date(`2026-10-21T12:00:0${3 - i}Z`) }),
    );
    const { service, calls } = makeService(rows);
    const page = await service.activity({ limit: 3 });
    assert.equal(calls.take, 4);
    assert.equal(page.items.length, 3);
    assert.match(page.next ?? '', /^2026-10-21T12:00:01\.000Z\|3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f02$/);
  });

  it('sin más páginas, next es null', async () => {
    const { service } = makeService([log('3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f00')]);
    assert.equal((await service.activity({ limit: 3 })).next, null);
  });

  it('una edición trae sus cambios y quién la hizo; una alta no trae diff', async () => {
    const { service } = makeService([
      log('3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f00'),
      log('3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f01', { action: 'CREATE', before: null, after: { name: 'Central' }, entity: 'branch' }),
    ]);
    const { items } = await service.activity({});
    assert.deepEqual(items[0]!.changes, [{ field: 'city', from: 'La Paz', to: 'Sucre' }]);
    assert.equal(items[0]!.actorName, 'Sara Admin');
    assert.equal(items[0]!.ip, '10.0.0.1');
    assert.deepEqual(items[1]!.changes, []);
  });

  it('🔴 un cambio hecho por Kobrax por consola no se atribuye a la persona dueña', async () => {
    const { service } = makeService([log('3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f00', { before: { planCode: 'FREE' }, after: { planCode: 'BUSINESS', via: 'plan:set' } })]);
    const { items } = await service.activity({});
    assert.equal(items[0]!.via, 'plan:set');
    assert.equal(items[0]!.actorName, null);
  });
});

describe('AccountActivityService.planHistory', () => {
  it('lista sólo los cambios de plan o de estado hechos por consola, del más nuevo al más viejo', async () => {
    const { service } = makeService([
      log('a', { before: { planCode: 'FREE' }, after: { planCode: 'BUSINESS', via: 'plan:set' } }),
      log('b', { before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED', via: 'account:suspend' } }),
      log('c', { before: { planCode: 'PROFESSIONAL', status: 'TRIAL' }, after: { planCode: 'FREE', status: 'ACTIVE', via: 'plan:lifecycle' } }),
    ]);
    const h = await service.planHistory();
    assert.deepEqual(h.map((e) => e.via), ['plan:set', 'account:suspend', 'plan:lifecycle']);
    assert.deepEqual([h[0]!.fromPlan, h[0]!.toPlan], ['FREE', 'BUSINESS']);
    assert.deepEqual([h[1]!.fromStatus, h[1]!.toStatus], ['ACTIVE', 'SUSPENDED']);
    assert.deepEqual([h[2]!.fromPlan, h[2]!.toPlan, h[2]!.toStatus], ['PROFESSIONAL', 'FREE', 'ACTIVE']);
  });

  it('descarta lo que lo hizo una persona (sin via) y los ajustes de topes que no cambian plan ni estado', async () => {
    const { service } = makeService([
      log('a', { before: { businessName: 'A' }, after: { businessName: 'B' } }),
      log('b', { before: { planCode: 'FREE', limitsOverride: null }, after: { planCode: 'FREE', limitsOverride: { users: 5 }, via: 'plan:set' } }),
    ]);
    assert.deepEqual(await service.planHistory(), []);
  });
});
