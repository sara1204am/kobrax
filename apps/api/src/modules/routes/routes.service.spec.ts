import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoutesService } from './routes.service';
import type { OsrmService } from './osrm.service';
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
    /** Cliente que resuelve `addStop` (`null` = id de otro tenant, la RLS no lo devuelve). */
    stopClient?: unknown;
    /** Caso que resuelve `addStop` (`null` = id de otro tenant). */
    stopCase?: unknown;
    permissions?: string[];
    routes?: unknown[];
    route?: { id: string; collectorId: string; totalDistanceKm?: number; estimatedMinutes?: number };
    /** La ruta que ese cobrador YA tiene ese día. `undefined` = no tiene, y se puede armar. */
    routeOfDay?: { id: string };
    stops?: FakeStop[];
    /** Punto de cada parada (`null` = cliente sin ubicación cargada). Sólo lo usa el preview. */
    points?: Record<string, { latitude: number; longitude: number } | null>;
    osrm?: Partial<OsrmService>;
  } = {},
) {
  const calls = {
    routeCreate: [] as Record<string, unknown>[],
    routeUpdate: [] as Record<string, unknown>[],
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
    // `addStop` valida que el cliente y el caso sean del tenant antes de insertar: bajo RLS un
    // `findFirst` que no encuentra es exactamente "no es tuyo". `null` simula el id ajeno.
    client: { findFirst: async () => (opts.stopClient === undefined ? { id: 'c1' } : opts.stopClient) },
    collectionCase: {
      findMany: async () => opts.cases ?? [],
      findFirst: async () => (opts.stopCase === undefined ? { id: 'case1' } : opts.stopCase),
    },
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
      // Las paradas salen del MISMO store en memoria, así un reordenamiento se ve en la lectura
      // siguiente. `client` se sintetiza desde `opts.points`.
      findFirst: async (args?: { where?: Record<string, unknown> }) => {
        // La pregunta «¿este cobrador ya tiene ruta ese día?» es la única que lleva `plannedDate`.
        // Distinguirla acá es lo que hace que el test falle si la guarda consultara sin el día.
        if (args?.where?.plannedDate !== undefined) return opts.routeOfDay ?? null;
        return opts.route ? { ...opts.route, stops: sorted({ routeId: opts.route.id }).map(withClient) } : null;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        calls.routeUpdate.push(args.data);
        return { ...opts.route, ...args.data };
      },
    },
  };
  function withClient(s: FakeStop) {
    const p = opts.points?.[s.id];
    return {
      ...s,
      visitedAt: null,
      client: {
        firstName: 'Ana',
        lastName: 'Ruiz',
        businessName: null,
        locations: p ? [{ locationType: 'HOME', address: null, latitude: p.latitude, longitude: p.longitude }] : [],
      },
    };
  }
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const perms = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'u1', permissions: perms, can: (p: string) => perms.includes(p) };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const events = { emit: () => {} };
  // Sin motor por defecto: el preview se degrada, que es el camino sin OSRM.
  const osrm = { route: async () => null, trip: async () => null, ...opts.osrm };
  const service = new RoutesService(
    prisma as never,
    tenant as never,
    audit as never,
    events as never,
    { decrypt: (v: string) => v } as never,
    osrm as never,
  );
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

  it('🔴 no crea una segunda ruta del mismo día (ROUTE_DUPLICATE_DAY)', async () => {
    // La jornada de una persona es una sola. Pasaba con un borrador que se sincronizaba dos veces.
    const { service, calls } = makeService({ permissions: ASSIGN, routeOfDay: { id: 'r-de-hoy' } });
    await rejectsWithCode(service.create(GEN), 'ROUTE_DUPLICATE_DAY');
    assert.equal(calls.routeCreate.length, 0, 'no llega a insertar');
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

  it('🔴 no genera una segunda ruta del mismo día (ROUTE_DUPLICATE_DAY)', async () => {
    // Dos toques en «armar la ruta de hoy» dejaban dos rutas. Y se corta ANTES de leer los casos:
    // la ruta ya existe, no hay nada que decidir.
    const { service, calls } = makeService({
      cases: [{ id: 'caseA', clientId: 'clA' }],
      permissions: ASSIGN,
      routeOfDay: { id: 'r-de-hoy' },
    });
    await rejectsWithCode(service.generate(GEN), 'ROUTE_DUPLICATE_DAY');
    assert.equal(calls.routeCreate.length, 0, 'no llega a insertar');
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

  // La RLS no alcanza sola: el chequeo de la FK lo hace Postgres saltándola, así que sin este
  // `findFirst` explícito un id de otro tenant entraba y dejaba la parada apuntando a su cartera.
  it('rechaza un cliente que no es del tenant', async () => {
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: [], stopClient: null });
    await rejectsWithCode(service.addStop('r1', ADD), 'RESOURCE_NOT_FOUND');
  });

  it('rechaza un caso que no es del tenant', async () => {
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: [], stopCase: null });
    await rejectsWithCode(service.addStop('r1', { clientId: 'cl9', caseId: 'ajeno' } as never), 'RESOURCE_NOT_FOUND');
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

// ── Preview y optimización (S3) ──────────────────────────────────────────────

/** Las tres paradas, cada una con su punto en el mapa. */
const THREE_POINTS = {
  s1: { latitude: -17.78, longitude: -63.18 },
  s2: { latitude: -17.76, longitude: -63.19 },
  s3: { latitude: -17.75, longitude: -63.2 },
};
/** Un recorrido de OSRM de 12 km / 45 min, en tres tramos. */
const fakePath = (km: number, min: number) => ({
  distanceM: km * 1000,
  durationS: min * 60,
  geometry: [{ latitude: -17.78, longitude: -63.18 }, { latitude: -17.75, longitude: -63.2 }],
  legs: [
    { distanceM: (km * 1000) / 2, durationS: (min * 60) / 2 },
    { distanceM: (km * 1000) / 2, durationS: (min * 60) / 2 },
  ],
});

describe('RoutesService.preview (S3)', () => {
  const setup = (osrm: Record<string, unknown>, route = OWN_ROUTE) =>
    makeService({ route, permissions: FIELD, stops: threeStops(), points: THREE_POINTS, osrm: osrm as never });

  it('la duración suma la permanencia en cada parada, no sólo el manejo', async () => {
    const { service } = setup({ route: async () => fakePath(12.4, 45) });
    const p = await service.preview('r1');
    assert.equal(p.distanceKm, 12.4);
    assert.equal(p.minutes, 45 + 10 * 3); // 3 paradas × 10 min de permanencia
  });

  it('la hora estimada de cada parada corre con los tramos reales', async () => {
    const { service } = setup({ route: async () => fakePath(12, 40) });
    const p = await service.preview('r1');
    // Salida = 0; después cada tramo (20 min) más la permanencia de la parada anterior (10).
    assert.deepEqual(p.stops.map((s) => s.etaMinutes), [0, 30, 60]);
  });

  it('cachea distancia y duración en la ruta (es lo que se muestra sin señal)', async () => {
    const { service, calls } = setup({ route: async () => fakePath(12.4, 45) });
    await service.preview('r1');
    assert.deepEqual(calls.routeUpdate[0], { totalDistanceKm: 12.4, estimatedMinutes: 75 });
  });

  it('sin motor devuelve los últimos números conocidos y ninguna geometría', async () => {
    const { service } = setup({}, { ...OWN_ROUTE, totalDistanceKm: 9.1, estimatedMinutes: 60 });
    const p = await service.preview('r1');
    assert.deepEqual(p.geometry, []);
    assert.equal(p.distanceKm, 9.1);
    assert.equal(p.minutes, 60);
    assert.equal(p.suggestion, undefined);
  });

  it('sugiere reordenar cuando el ahorro pasa el umbral', async () => {
    const { service } = setup({
      route: async () => fakePath(12.4, 45),
      trip: async () => ({ ...fakePath(9.9, 30), order: [0, 2, 1] }),
    });
    const p = await service.preview('r1');
    assert.equal(p.suggestion!.savedKm, 2.5);
    assert.equal(p.suggestion!.savedMinutes, 15);
    assert.deepEqual(p.suggestion!.order, ['s1', 's3', 's2']);
  });

  it('NO sugiere nada por un ahorro insignificante (la alerta se vuelve ruido)', async () => {
    const { service } = setup({
      route: async () => fakePath(12.4, 45),
      trip: async () => ({ ...fakePath(12.2, 44), order: [0, 2, 1] }),
    });
    const p = await service.preview('r1');
    assert.equal(p.suggestion, undefined);
  });

  it('una parada sin coordenadas queda en la lista, sin estimación y sin romper el cálculo', async () => {
    const { service } = makeService({
      route: OWN_ROUTE,
      permissions: FIELD,
      stops: threeStops(),
      points: { ...THREE_POINTS, s2: null },
      osrm: { route: async () => fakePath(8, 20) } as never,
    });
    const p = await service.preview('r1');
    assert.equal(p.stops.length, 3);
    assert.equal(p.stops.find((s) => s.id === 's2')!.etaMinutes, undefined);
    assert.equal(p.distanceKm, 8);
  });

  it('no se previsualiza la ruta de otro cobrador', async () => {
    const { service } = setup({}, { id: 'r1', collectorId: 'otro' });
    await rejectsWithCode(service.preview('r1'), 'RESOURCE_NOT_FOUND');
  });
});

describe('RoutesService.optimize (S3)', () => {
  it('aplica el orden sugerido y la secuencia queda sin huecos', async () => {
    const { service, order, stops } = makeService({
      route: OWN_ROUTE,
      permissions: FIELD,
      stops: threeStops(),
      points: THREE_POINTS,
      osrm: {
        route: async () => fakePath(12.4, 45),
        trip: async () => ({ ...fakePath(9.9, 30), order: [0, 2, 1] }),
      } as never,
    });
    await service.optimize('r1');
    assert.deepEqual(order(), ['s1', 's3', 's2']);
    assert.deepEqual(stops.map((s) => s.sequenceOrder).sort(), [1, 2, 3]);
  });

  it('sin sugerencia no toca el orden', async () => {
    const { service, order } = makeService({
      route: OWN_ROUTE,
      permissions: FIELD,
      stops: threeStops(),
      points: THREE_POINTS,
      osrm: { route: async () => fakePath(12.4, 45) } as never,
    });
    await service.optimize('r1');
    assert.deepEqual(order(), ['s1', 's2', 's3']);
  });

  it('la parada sin coordenadas no se pierde: queda al final', async () => {
    const { service, order } = makeService({
      route: OWN_ROUTE,
      permissions: FIELD,
      stops: [
        ...threeStops(),
        { id: 's4', routeId: 'r1', clientId: 'cl4', caseId: 'ca4', sequenceOrder: 4, status: 'PENDING' },
      ],
      // s2 no tiene punto: no entra al cálculo, pero sigue siendo una parada del recorrido.
      points: { s1: THREE_POINTS.s1, s2: null, s3: THREE_POINTS.s3, s4: { latitude: -17.74, longitude: -63.21 } },
      osrm: {
        route: async () => fakePath(12.4, 45),
        trip: async () => ({ ...fakePath(9.9, 30), order: [0, 2, 1] }), // s1, s4, s3
      } as never,
    });
    await service.optimize('r1');
    assert.deepEqual(order(), ['s1', 's4', 's3', 's2']);
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
