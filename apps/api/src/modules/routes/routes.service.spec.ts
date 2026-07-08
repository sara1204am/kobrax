import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoutesService } from './routes.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { ua?: unknown; cases?: unknown[]; permissions?: string[]; routes?: unknown[] } = {}) {
  const calls = {
    routeCreate: [] as Record<string, unknown>[],
    audit: [] as string[],
    listWhere: undefined as Record<string, unknown> | undefined,
  };
  const tx = {
    userAccount: { findFirst: async () => (opts.ua === undefined ? { id: 'ua1' } : opts.ua) },
    collectionCase: { findMany: async () => opts.cases ?? [] },
    routePlan: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.routeCreate.push(args.data);
        const stops = (args.data.stops as { create: unknown[] })?.create ?? [];
        return { id: 'r1', ...args.data, stops };
      },
      findMany: async (args: { where?: Record<string, unknown> }) => {
        calls.listWhere = args.where;
        return opts.routes ?? [];
      },
      count: async () => (opts.routes ?? []).length,
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const perms = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'u1', permissions: perms, can: (p: string) => perms.includes(p) };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const events = { emit: () => {} };
  const service = new RoutesService(prisma as never, tenant as never, audit as never, events as never);
  return { service, calls };
}

const GEN = { collectorId: '11111111-1111-1111-1111-111111111111', plannedDate: '2026-06-20' } as never;

describe('RoutesService.create', () => {
  it('rechaza un cobrador ajeno al tenant (ROUTE_COLLECTOR)', async () => {
    const { service } = makeService({ ua: null });
    await rejectsWithCode(service.create(GEN), 'ROUTE_COLLECTOR');
  });
});

describe('RoutesService.generate', () => {
  it('crea la ruta con paradas secuenciadas desde los casos (ordenados por prioridad)', async () => {
    const cases = [
      { id: 'caseA', clientId: 'clA' },
      { id: 'caseB', clientId: 'clB' },
    ];
    const { service, calls } = makeService({ cases });
    const r = await service.generate(GEN);
    assert.equal(r.totalCases, 2);
    const stops = (calls.routeCreate[0]!.stops as { create: { caseId: string; sequenceOrder: number }[] }).create;
    assert.deepEqual(stops.map((s) => [s.caseId, s.sequenceOrder]), [['caseA', 1], ['caseB', 2]]);
    assert.ok(calls.audit.includes('GENERATE'));
  });

  it('rechaza si no hay casos para la ruta (ROUTE_EMPTY)', async () => {
    const { service } = makeService({ cases: [] });
    await rejectsWithCode(service.generate(GEN), 'ROUTE_EMPTY');
  });
});

describe('RoutesService.list (scope por capacidad)', () => {
  it('cobrador sin ROUTE_ASSIGN solo ve sus rutas (fuerza collectorId al propio)', async () => {
    const { service, calls } = makeService({ routes: [] });
    await service.list({ collectorId: 'otro' } as never);
    assert.equal(calls.listWhere!.collectorId, 'u1');
  });

  it('con ROUTE_ASSIGN respeta el collectorId pedido', async () => {
    const { service, calls } = makeService({ permissions: ['route:assign'], routes: [] });
    await service.list({ collectorId: 'otro' } as never);
    assert.equal(calls.listWhere!.collectorId, 'otro');
  });
});
