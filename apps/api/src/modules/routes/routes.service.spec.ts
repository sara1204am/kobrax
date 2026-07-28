import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoutesService } from './routes.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

/** Parada del falso de Prisma: lo mínimo que el service lee y escribe. */
interface FakeStop {
  id: string;
  routeId: string;
  clientId: string;
  caseId?: string;
  sequenceOrder: number;
  status: string;
}

function makeService(
  opts: {
    ua?: unknown;
    cases?: unknown[];
    permissions?: string[];
    routes?: unknown[];
    route?: { id: string; collectorId: string };
    stops?: FakeStop[];
  } = {},
) {
  const calls = {
    routeCreate: [] as Record<string, unknown>[],
    audit: [] as string[],
    listWhere: undefined as Record<string, unknown> | undefined,
  };
  // Store real en memoria: la secuencia de paradas es la lógica que hay que probar de verdad.
  const stops: FakeStop[] = opts.stops ? opts.stops.map((s) => ({ ...s })) : [];
  const hit = (s: FakeStop, w: Record<string, unknown> = {}) =>
    (w.id === undefined || s.id === w.id) &&
    (w.routeId === undefined || s.routeId === w.routeId) &&
    (w.caseId === undefined || s.caseId === w.caseId);
  const sorted = (w: Record<string, unknown>, dir: 'asc' | 'desc' = 'asc') =>
    stops.filter((s) => hit(s, w)).sort((a, b) => (dir === 'asc' ? a.sequenceOrder - b.sequenceOrder : b.sequenceOrder - a.sequenceOrder));

  const tx = {
    userAccount: { findFirst: async () => (opts.ua === undefined ? { id: 'ua1' } : opts.ua) },
    collectionCase: { findMany: async () => opts.cases ?? [] },
    routeStop: {
      findFirst: async (args: { where: Record<string, unknown>; orderBy?: { sequenceOrder?: 'asc' | 'desc' } }) =>
        sorted(args.where, args.orderBy?.sequenceOrder ?? 'asc')[0] ?? null,
      findFirstOrThrow: async (args: { where: Record<string, unknown> }) => {
        const found = sorted(args.where)[0];
        if (!found) throw new Error('no encontrado');
        return found;
      },
      findMany: async (args: { where: Record<string, unknown> }) => sorted(args.where),
      create: async (args: { data: Record<string, unknown> }) => {
        const created = { ...(args.data as unknown as FakeStop), id: `s${stops.length + 1}`, status: 'PENDING' };
        stops.push(created);
        return { ...created, client: null };
      },
      delete: async (args: { where: { id: string } }) => {
        const i = stops.findIndex((s) => s.id === args.where.id);
        return stops.splice(i, 1)[0]!;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = stops.find((x) => x.id === args.where.id)!;
        Object.assign(s, args.data);
        return s;
      },
    },
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
      findFirst: async () => opts.route ?? null,
      update: async (args: { data: Record<string, unknown> }) => ({ ...opts.route, ...args.data }),
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const perms = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'u1', permissions: perms, can: (p: string) => perms.includes(p) };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const events = { emit: () => {} };
  const service = new RoutesService(prisma as never, tenant as never, audit as never, events as never, {} as never);
  /** El orden real del recorrido, para asertar contra él. */
  const order = () => stops.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((s) => s.id);
  return { service, calls, stops, order };
}

const COLLECTOR_ID = '11111111-1111-1111-1111-111111111111';
const GEN = { collectorId: COLLECTOR_ID, plannedDate: '2026-06-20' } as never;
/** Generar exige capacidad: `assign` (para cualquiera) o `execute` (sólo la propia). */
const ASSIGN = ['route:read', 'route:assign'];

describe('RoutesService.create', () => {
  it('rechaza un cobrador ajeno al tenant (ROUTE_COLLECTOR)', async () => {
    const { service } = makeService({ ua: null, permissions: ASSIGN });
    await rejectsWithCode(service.create(GEN), 'ROUTE_COLLECTOR');
  });

  it('el cobrador crea SU ruta aunque el body pida otro (mismo scope que generate)', async () => {
    const { service, calls } = makeService({ permissions: ['route:read', 'route:execute'] });
    await service.create(GEN);
    assert.equal(calls.routeCreate[0]!.collectorId, 'u1');
  });
});

describe('RoutesService.generate', () => {
  it('crea la ruta con paradas secuenciadas desde los casos (ordenados por prioridad)', async () => {
    const cases = [
      { id: 'caseA', clientId: 'clA' },
      { id: 'caseB', clientId: 'clB' },
    ];
    const { service, calls } = makeService({ cases, permissions: ASSIGN });
    const r = await service.generate(GEN);
    assert.equal(r.totalCases, 2);
    const stops = (calls.routeCreate[0]!.stops as { create: { caseId: string; sequenceOrder: number }[] }).create;
    assert.deepEqual(stops.map((s) => [s.caseId, s.sequenceOrder]), [['caseA', 1], ['caseB', 2]]);
    assert.ok(calls.audit.includes('GENERATE'));
  });

  it('rechaza si no hay casos para la ruta (ROUTE_EMPTY)', async () => {
    const { service } = makeService({ cases: [], permissions: ASSIGN });
    await rejectsWithCode(service.generate(GEN), 'ROUTE_EMPTY');
  });

  it('el cobrador (ROUTE_EXECUTE) genera SU ruta aunque el body pida otro cobrador', async () => {
    const { service, calls } = makeService({ cases: [{ id: 'c1', clientId: 'cl1' }], permissions: ['route:read', 'route:execute'] });
    await service.generate(GEN);
    assert.equal(calls.routeCreate[0]!.collectorId, 'u1');
  });

  it('con ROUTE_ASSIGN genera para el cobrador pedido', async () => {
    const { service, calls } = makeService({ cases: [{ id: 'c1', clientId: 'cl1' }], permissions: ASSIGN });
    await service.generate(GEN);
    assert.equal(calls.routeCreate[0]!.collectorId, COLLECTOR_ID);
  });

  it('el observador de cuenta (sin execute ni assign) no genera (AUTH_002)', async () => {
    const { service } = makeService({ cases: [{ id: 'c1', clientId: 'cl1' }], permissions: ['route:read'] });
    await rejectsWithCode(service.generate(GEN), 'AUTH_002');
  });
});

describe('RoutesService.updateStatus (scope por capacidad)', () => {
  it('el cobrador arranca SU ruta', async () => {
    const { service, calls } = makeService({ route: { id: 'r1', collectorId: 'u1' }, permissions: ['route:read', 'route:execute'] });
    await service.updateStatus('r1', { status: 'IN_PROGRESS' } as never);
    assert.ok(calls.audit.includes('UPDATE'));
  });

  it('el cobrador NO toca la ruta de otro (404, no filtra que exista)', async () => {
    const { service } = makeService({ route: { id: 'r1', collectorId: 'otro' }, permissions: ['route:read', 'route:execute'] });
    await rejectsWithCode(service.updateStatus('r1', { status: 'IN_PROGRESS' } as never), 'RESOURCE_NOT_FOUND');
  });

  it('el observador de cuenta no cambia estados (AUTH_002)', async () => {
    const { service } = makeService({ route: { id: 'r1', collectorId: 'u1' }, permissions: ['route:read'] });
    await rejectsWithCode(service.updateStatus('r1', { status: 'IN_PROGRESS' } as never), 'AUTH_002');
  });
});

// ── Paradas desde el mapa (S2) ────────────────────────────────────────────────
const OWN_ROUTE = { id: 'r1', collectorId: 'u1' };
const FIELD = ['route:read', 'route:execute'];
const threeStops = (): FakeStop[] => [
  { id: 's1', routeId: 'r1', clientId: 'cl1', caseId: 'ca1', sequenceOrder: 1, status: 'PENDING' },
  { id: 's2', routeId: 'r1', clientId: 'cl2', caseId: 'ca2', sequenceOrder: 2, status: 'PENDING' },
  { id: 's3', routeId: 'r1', clientId: 'cl3', caseId: 'ca3', sequenceOrder: 3, status: 'PENDING' },
];
const ADD = { clientId: 'cl9', caseId: 'ca9' } as never;

describe('RoutesService.addStop', () => {
  it('la parada nueva va al final del recorrido', async () => {
    const { service, order } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    const stop = await service.addStop('r1', ADD);
    assert.equal(stop.sequenceOrder, 4);
    assert.deepEqual(order(), ['s1', 's2', 's3', 's4']);
  });

  it('el mismo caso no entra dos veces (dos toques sobre el mismo pin)', async () => {
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    await rejectsWithCode(service.addStop('r1', { clientId: 'cl2', caseId: 'ca2' } as never), 'ROUTE_STOP_DUPLICATE');
  });

  it('no se le agregan paradas a la ruta de otro (404, no filtra que exista)', async () => {
    const { service } = makeService({ route: { id: 'r1', collectorId: 'otro' }, permissions: FIELD, stops: [] });
    await rejectsWithCode(service.addStop('r1', ADD), 'RESOURCE_NOT_FOUND');
  });
});

describe('RoutesService.removeStop', () => {
  it('quitar la del medio corre las siguientes: sin agujeros en la secuencia', async () => {
    const { service, stops, order } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    await service.removeStop('r1', 's2');
    assert.deepEqual(order(), ['s1', 's3']);
    assert.deepEqual(stops.map((s) => s.sequenceOrder).sort(), [1, 2]);
  });

  it('una parada ya visitada no se quita (es historia de la jornada)', async () => {
    const visitadas = threeStops();
    visitadas[1]!.status = 'VISITED';
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: visitadas });
    await rejectsWithCode(service.removeStop('r1', 's2'), 'ROUTE_STOP_DONE');
  });
});

describe('RoutesService.updateStop (mover de posición)', () => {
  it('mover la última al principio reordena todo sin chocar la restricción', async () => {
    const { service, stops, order } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    await service.updateStop('r1', 's3', { sequenceOrder: 1 } as never);
    assert.deepEqual(order(), ['s3', 's1', 's2']);
    assert.deepEqual(stops.map((s) => s.sequenceOrder).sort(), [1, 2, 3]); // sin duplicados ni huecos
  });

  it('una posición fuera de rango se acota al largo del recorrido', async () => {
    const { service, order } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    await service.updateStop('r1', 's1', { sequenceOrder: 99 } as never);
    assert.deepEqual(order(), ['s2', 's3', 's1']);
  });

  it('cambiar el estado sigue funcionando (lo usa S5)', async () => {
    const { service, stops } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    const res = await service.updateStop('r1', 's2', { status: 'VISITED' } as never);
    assert.equal(res.status, 'VISITED');
    assert.ok(stops.find((s) => s.id === 's2')!.visitedAt);
  });

  it('no se toca la parada de una ruta ajena', async () => {
    const { service } = makeService({ route: { id: 'r1', collectorId: 'otro' }, permissions: FIELD, stops: threeStops() });
    await rejectsWithCode(service.updateStop('r1', 's1', { sequenceOrder: 2 } as never), 'RESOURCE_NOT_FOUND');
  });
});

describe('RoutesService.list (scope por capacidad)', () => {
  it('cobrador (ROUTE_EXECUTE sin ROUTE_ASSIGN) solo ve sus rutas (fuerza collectorId al propio)', async () => {
    const { service, calls } = makeService({ permissions: ['route:read', 'route:execute'], routes: [] });
    await service.list({ collectorId: 'otro' } as never);
    assert.equal(calls.listWhere!.collectorId, 'u1');
  });

  it('observador de cuenta (ROUTE_READ sin execute ni assign = auditor) ve todas las rutas', async () => {
    const { service, calls } = makeService({ permissions: ['route:read'], routes: [] });
    await service.list({} as never);
    assert.equal(calls.listWhere!.collectorId, undefined);
  });

  it('con ROUTE_ASSIGN respeta el collectorId pedido', async () => {
    const { service, calls } = makeService({ permissions: ['route:assign'], routes: [] });
    await service.list({ collectorId: 'otro' } as never);
    assert.equal(calls.listWhere!.collectorId, 'otro');
  });
});
