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
  creditId?: string;
  sequenceOrder: number;
  status: string;
}

function makeService(
  opts: {
    ua?: unknown;
    /** Créditos que devuelve el `$queryRaw` de alcance/mora: `{ id, client_id }`. */
    credits?: { id: string; client_id: string }[];
    /** Cliente que resuelve `addStop` (`null` = id de otro tenant, la RLS no lo devuelve). */
    stopClient?: unknown;
    /** Crédito de `addStop` fuera de alcance (`null`) o visible (default). */
    stopCase?: unknown;
    permissions?: string[];
    routes?: unknown[];
    route?: { id: string; collectorId: string; createdBy?: string | null; status?: string; plannedDate?: Date; totalDistanceKm?: number; estimatedMinutes?: number };
    /** La ruta que ese cobrador YA tiene ese día. `undefined` = no tiene, y se puede armar. */
    routeOfDay?: { id: string };
    /** Ruta que ya existe con el id que manda el cliente (reintento). */
    priorRoute?: Record<string, unknown>;
    /** La 1ª creación choca con la PK y la 2ª encuentra la ruta `priorRoute`. */
    routeRace?: boolean;
    /** Los perfiles del equipo, para el orden por nombre de cobrador. */
    profiles?: { userId: string; firstName: string | null; lastName: string | null }[];
    stops?: FakeStop[];
    /** Visitas agendadas pendientes del cobrador para el día (`agenda_items` VISIT). */
    visits?: { id: string; creditId: string; clientId: string }[];
    /** Punto de cada parada (`null` = cliente sin ubicación cargada). Sólo lo usa el preview. */
    points?: Record<string, { latitude: number; longitude: number } | null>;
    osrm?: Partial<OsrmService>;
    /** Ubicaciones de los clientes que consulta `resolveLocations` (F4/12). */
    locations?: { id: string; clientId: string; locationType: string; relationId: string | null; latitude: number | null; longitude: number | null }[];
    /** El cambio de estado choca: otra persona lo cambió antes (updateMany devuelve 0). */
    statusRace?: boolean;
    /** Visitas ya registradas en la ruta (F4/12: con alguna no se cancela). */
    visitCount?: number;
    /** Día «de hoy» de la empresa para validar que no se arme una ruta del pasado. */
    today?: string;
  } = {},
) {
  const calls = {
    routeCreate: [] as Record<string, unknown>[],
    routeUpdate: [] as Record<string, unknown>[],
    routeUpdateWhere: [] as Record<string, unknown>[],
    events: [] as string[],
    audit: [] as string[],
    listWhere: undefined as Record<string, unknown> | undefined,
    listOrderBy: undefined as unknown,
    rawSql: [] as string[],
    stopUpdateMany: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  };
  // Store real en memoria: la secuencia de paradas es la lógica que hay que probar de verdad.
  const stops: FakeStop[] = opts.stops ? opts.stops.map((s) => ({ ...s })) : [];
  const hit = (s: FakeStop, w: Record<string, unknown> = {}) =>
    (w.id === undefined || s.id === w.id) &&
    (w.routeId === undefined || s.routeId === w.routeId) &&
    (w.creditId === undefined || s.creditId === w.creditId);
  const sorted = (w: Record<string, unknown>, dir: 'asc' | 'desc' = 'asc') =>
    stops.filter((s) => hit(s, w)).sort((a, b) => (dir === 'asc' ? a.sequenceOrder - b.sequenceOrder : b.sequenceOrder - a.sequenceOrder));

  let raced = false;
  const tx = {
    userAccount: { findFirst: async () => (opts.ua === undefined ? { id: 'ua1' } : opts.ua) },
    profile: { findMany: async () => opts.profiles ?? [] },
    // `addStop` valida que el cliente y el caso sean del tenant antes de insertar: bajo RLS un
    // `findFirst` que no encuentra es exactamente "no es tuyo". `null` simula el id ajeno.
    client: { findFirst: async () => (opts.stopClient === undefined ? { id: 'c1' } : opts.stopClient) },
    // Alcance y selección de créditos (`visibleCredits`, `chosenCredits`, créditos en mora del cobrador).
    $queryRaw: async (q: { sql: string }) => {
      calls.rawSql.push(q.sql);
      if (opts.stopCase === null) return [];
      return opts.credits ?? [{ id: 'cr9', client_id: 'cl9' }];
    },
    credit: { findMany: async () => [] },
    // F4/12: la ubicación concreta de cada parada. Sin ubicaciones cargadas no hay nada que resolver ni exigir.
    clientLocation: { findMany: async () => opts.locations ?? [] },
    // El detalle cuenta visitas y pedidos de cambio pendientes.
    fieldVisit: { count: async () => opts.visitCount ?? 0 },
    routeChangeRequest: { count: async () => 0 },
    payment: { groupBy: async () => [] },
    agendaItem: { findMany: async () => opts.visits ?? [] },
    routeStop: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.stopUpdateMany.push(args);
        return { count: 0 };
      },
      findFirst: async (args: { where: Record<string, unknown>; orderBy?: { sequenceOrder?: 'asc' | 'desc' } }) =>
        sorted(args.where, args.orderBy?.sequenceOrder ?? 'asc')[0] ?? null,
      findFirstOrThrow: async (args: { where: Record<string, unknown> }) => {
        const found = sorted(args.where)[0];
        if (!found) throw new Error('no encontrado');
        return found;
      },
      // Las paradas que ya llevan una visita (`agendaItemId`): en estas pruebas, ninguna.
      findMany: async (args: { where: Record<string, unknown> }) => (args.where.agendaItemId !== undefined ? [] : sorted(args.where)),
      count: async (args: { where: Record<string, unknown> }) => sorted(args.where).length,
      // Cuántas paradas visitadas tiene cada ruta, desde el MISMO store: así el contador del
      // listado se prueba contra paradas de verdad y no contra un número inventado en el mock.
      groupBy: async (args: { where: { routeId: { in: string[] }; status: string } }) => {
        const by = new Map<string, number>();
        for (const s of stops) {
          if (!args.where.routeId.in.includes(s.routeId) || s.status !== args.where.status) continue;
          by.set(s.routeId, (by.get(s.routeId) ?? 0) + 1);
        }
        return [...by].map(([routeId, n]) => ({ routeId, _count: { _all: n } }));
      },
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
        if (opts.routeRace && !raced) {
          raced = true;
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        calls.routeCreate.push(args.data);
        const stops = (args.data.stops as { create: unknown[] })?.create ?? [];
        return { id: 'r1', ...args.data, stops };
      },
      findMany: async (args: { where?: Record<string, unknown>; orderBy?: unknown; select?: unknown }) => {
        calls.listWhere = args.where;
        if (args.orderBy) calls.listOrderBy = args.orderBy;
        const all = (opts.routes ?? []) as { id: string }[];
        // El orden por cobrador vuelve a pedir las filas por id: se devuelven las pedidas, y en el
        // orden del store, para que el test compruebe el reordenamiento del servicio y no el del mock.
        const ids = (args.where as { id?: { in?: string[] } })?.id?.in;
        return ids ? all.filter((r) => ids.includes(r.id)) : all;
      },
      count: async () => (opts.routes ?? []).length,
      // Las paradas salen del MISMO store en memoria, así un reordenamiento se ve en la lectura
      // siguiente. `client` se sintetiza desde `opts.points`.
      findFirst: async (args?: { where?: Record<string, unknown> }) => {
        // La pregunta «¿este cobrador ya tiene ruta ese día?» es la única que lleva `plannedDate`.
        // Distinguirla acá es lo que hace que el test falle si la guarda consultara sin el día.
        // Reintento por id: `where: { id }` sin día.
        if (opts.priorRoute !== undefined && args?.where?.id !== undefined && args.where.plannedDate === undefined) {
          if (opts.routeRace && !raced) return null;
          return opts.priorRoute ?? null;
        }
        if (args?.where?.plannedDate !== undefined) return opts.routeOfDay ?? null;
        // Una ruta abierta por defecto (F4/12: una cerrada no se edita); `createdBy` ausente = anterior a F4/12.
        return opts.route ? { status: 'PLANNED', ...opts.route, stops: sorted({ routeId: opts.route.id }).map(withClient) } : null;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        calls.routeUpdate.push(args.data);
        return { ...opts.route, ...args.data };
      },
      // F4/12: el cambio de estado es condicional (`WHERE status = <el leído>`) y vuelve a leer la ruta.
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.routeUpdate.push(args.data);
        calls.routeUpdateWhere.push(args.where);
        return { count: opts.statusRace ? 0 : 1 };
      },
      findFirstOrThrow: async () => ({ plannedDate: new Date('2026-06-20'), ...opts.route, ...(calls.routeUpdate.at(-1) ?? {}) }),
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
  const events = { emit: (name: string) => void calls.events.push(name) };
  // Sin motor por defecto: el preview se degrada, que es el camino sin OSRM.
  const osrm = { route: async () => null, trip: async () => null, ...opts.osrm };
  const service = new RoutesService(
    prisma as never,
    tenant as never,
    audit as never,
    events as never,
    { decrypt: (v: string) => v } as never,
    osrm as never,
    { today: async () => new Date(`${opts.today ?? '2026-06-01'}T00:00:00.000Z`), timezone: async () => 'UTC' } as never,
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
  const CR = (...ids: string[]) => ids.map((id) => ({ id, client_id: 'cl-' + id }));
  type Created = { create: { creditId: string; clientId: string; sequenceOrder: number }[] };

  it('sin creditIds: paradas por CRÉDITO en mora del cobrador (por prioridad del episodio)', async () => {
    const { service, calls } = makeService({ credits: CR('crA', 'crB'), permissions: ASSIGN });
    const r = await service.generate(GEN);
    assert.equal(r.totalCases, 2); // nombre legado: cuenta paradas
    const stops = (calls.routeCreate[0]!.stops as Created).create;
    assert.deepEqual(stops.map((s) => [s.creditId, s.sequenceOrder]), [['crA', 1], ['crB', 2]]);
    assert.equal(stops[0]!.clientId, 'cl-crA');
    assert.ok(calls.audit.includes('GENERATE'));
    // El criterio: episodio abierto, prioridad del episodio, responsable/temporal/apoyo vigentes del cobrador.
    assert.match(calls.rawSql[0]!, /credit_arrear_episodes/);
    assert.match(calls.rawSql[0]!, /ep\.priority/);
    assert.match(calls.rawSql[0]!, /credit_assignments/);
    assert.match(calls.rawSql[0]!, /written_off_at IS NULL/);
  });

  it('🔴 con creditIds elegidos, las paradas quedan EN ESE ORDEN', async () => {
    // El recorrido que alguien armó mirando el mapa se perdía si se reordenaba por prioridad.
    const { service, calls } = makeService({ credits: CR('crA', 'crB', 'crC'), permissions: ASSIGN });
    await service.generate({ ...GEN, creditIds: ['crC', 'crA', 'crB'] } as never);
    const stops = (calls.routeCreate[0]!.stops as Created).create;
    assert.deepEqual(stops.map((s) => [s.creditId, s.sequenceOrder]), [['crC', 1], ['crA', 2], ['crB', 3]]);
  });

  it('un crédito pedido que no está a la vista se saltea, repetidos se quitan y el resto conserva su orden', async () => {
    const { service, calls } = makeService({ credits: CR('crA', 'crB'), permissions: ASSIGN });
    await service.generate({ ...GEN, creditIds: ['crB', 'crFuera', 'crA', 'crB'] } as never);
    const stops = (calls.routeCreate[0]!.stops as Created).create;
    assert.deepEqual(stops.map((s) => [s.creditId, s.sequenceOrder]), [['crB', 1], ['crA', 2]]);
    assert.match(calls.rawSql[0]!, /cr\.account_id/); // pasa por el alcance de mora
  });

  describe('visitas agendadas (F4/11 · E1)', () => {
    type Stop = { creditId: string; clientId: string; sequenceOrder: number; agendaItemId?: string };
    const V = (agendaItem: string, credit: string) => ({ id: agendaItem, creditId: credit, clientId: 'cl-' + credit });

    it('sin créditos elegidos las visitas del día entran PRIMERO y luego la mora', async () => {
      const { service, calls } = makeService({ credits: CR('crA', 'crB'), visits: [V('v1', 'crV')], permissions: ASSIGN });
      await service.generate(GEN);
      const stops = (calls.routeCreate[0]!.stops as { create: Stop[] }).create;
      assert.deepEqual(stops.map((s) => [s.creditId, s.sequenceOrder, s.agendaItemId]), [['crV', 1, 'v1'], ['crA', 2, undefined], ['crB', 3, undefined]]);
    });

    it('con créditos elegidos manda el orden elegido y las visitas van al final', async () => {
      const { service, calls } = makeService({ credits: CR('crA', 'crB'), visits: [V('v1', 'crV')], permissions: ASSIGN });
      await service.generate({ ...GEN, creditIds: ['crB', 'crA'] } as never);
      const stops = (calls.routeCreate[0]!.stops as { create: Stop[] }).create;
      assert.deepEqual(stops.map((s) => s.creditId), ['crB', 'crA', 'crV']);
    });

    it('si el crédito de la visita ya iba por mora, es UNA sola parada y lleva el vínculo', async () => {
      const { service, calls } = makeService({ credits: CR('crA', 'crB'), visits: [V('v1', 'crB')], permissions: ASSIGN });
      await service.generate(GEN);
      const stops = (calls.routeCreate[0]!.stops as { create: Stop[] }).create;
      assert.deepEqual(stops.map((s) => [s.creditId, s.agendaItemId]), [['crA', undefined], ['crB', 'v1']]);
    });

    it('una visita sola alcanza para armar la ruta (no hay mora)', async () => {
      const { service, calls } = makeService({ credits: [], visits: [V('v1', 'crV')], permissions: ASSIGN });
      const r = await service.generate(GEN);
      assert.equal(r.totalCases, 1);
      assert.equal((calls.routeCreate[0]!.stops as { create: Stop[] }).create[0]!.agendaItemId, 'v1');
    });
  });

  it('cancelar la ruta salta sus paradas: la visita agendada queda libre y el vínculo queda como historia', async () => {
    const { service, calls } = makeService({
      route: { id: 'r1', collectorId: 'u1' },
      permissions: ASSIGN,
      stops: [{ id: 's1', routeId: 'r1', clientId: 'c1', sequenceOrder: 1, status: 'PENDING' }],
    });
    await service.updateStatus('r1', { status: 'CANCELLED', reason: 'La cobradora está enferma' } as never);
    // F4/12: ya no se borra `agendaItemId` (se perdía la historia); SALTADA alcanza para liberar la visita.
    assert.deepEqual(calls.stopUpdateMany[0]!.data, { status: 'SKIPPED' });
  });

  it('rechaza si no hay créditos para la ruta (ROUTE_EMPTY)', async () => {
    const { service } = makeService({ credits: [], permissions: ASSIGN });
    await rejectsWithCode(service.generate(GEN), 'ROUTE_EMPTY');
  });

  it('🔴 no genera una segunda ruta del mismo día (ROUTE_DUPLICATE_DAY)', async () => {
    // Dos toques en «armar la ruta de hoy» dejaban dos rutas. Y se corta ANTES de leer los casos:
    // la ruta ya existe, no hay nada que decidir.
    const { service, calls } = makeService({
      credits: [{ id: 'crA', client_id: 'clA' }],
      permissions: ASSIGN,
      routeOfDay: { id: 'r-de-hoy' },
    });
    await rejectsWithCode(service.generate(GEN), 'ROUTE_DUPLICATE_DAY');
    assert.equal(calls.routeCreate.length, 0, 'no llega a insertar');
  });

  it('el cobrador (ROUTE_EXECUTE) genera SU ruta aunque el body pida otro cobrador', async () => {
    const { service, calls } = makeService({ credits: [{ id: 'cr1', client_id: 'cl1' }], permissions: ['route:read', 'route:execute'] });
    await service.generate(GEN);
    assert.equal(calls.routeCreate[0]!.collectorId, 'u1');
  });

  it('con ROUTE_ASSIGN genera para el cobrador pedido', async () => {
    const { service, calls } = makeService({ credits: [{ id: 'cr1', client_id: 'cl1' }], permissions: ASSIGN });
    await service.generate(GEN);
    assert.equal(calls.routeCreate[0]!.collectorId, COLLECTOR_ID);
  });

  it('el observador de cuenta (sin execute ni assign) no genera (AUTH_002)', async () => {
    const { service } = makeService({ credits: [{ id: 'cr1', client_id: 'cl1' }], permissions: ['route:read'] });
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
  { id: 's1', routeId: 'r1', clientId: 'cl1', creditId: 'cr1', sequenceOrder: 1, status: 'PENDING' },
  { id: 's2', routeId: 'r1', clientId: 'cl2', creditId: 'cr2', sequenceOrder: 2, status: 'PENDING' },
  { id: 's3', routeId: 'r1', clientId: 'cl3', creditId: 'cr3', sequenceOrder: 3, status: 'PENDING' },
];
const ADD = { clientId: 'cl9', creditId: 'cr9' } as never;

describe('RoutesService.addStop', () => {
  it('la parada nueva va al final del recorrido', async () => {
    const { service, order } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    const stop = await service.addStop('r1', ADD);
    assert.equal(stop.sequenceOrder, 4);
    assert.deepEqual(order(), ['s1', 's2', 's3', 's4']);
  });

  it('el mismo crédito no entra dos veces (dos toques sobre el mismo pin)', async () => {
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    await rejectsWithCode(service.addStop('r1', { clientId: 'cl2', creditId: 'cr2' } as never), 'ROUTE_STOP_DUPLICATE');
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

  it('rechaza un crédito fuera de alcance o de otro cliente', async () => {
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: [], stopCase: null });
    await rejectsWithCode(service.addStop('r1', { clientId: 'cl9', creditId: 'ajeno' } as never), 'RESOURCE_NOT_FOUND');
  });
});

describe('RoutesService.addStop por crédito (F4/08)', () => {
  it('guarda credit_id y recuenta el total desde las paradas', async () => {
    const { service, stops, calls } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    await service.addStop('r1', { clientId: 'cl9', creditId: 'cr9' } as never);
    const created = stops[stops.length - 1]!;
    assert.equal(created.creditId, 'cr9');
    assert.equal(calls.routeUpdate.at(-1)!.totalCases, 4);
  });

  it('el crédito se valida contra el cliente y el alcance de quien arma la ruta', async () => {
    const { service, calls } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: [] });
    await service.addStop('r1', ADD);
    assert.match(calls.rawSql[0]!, /cr\.client_id/);
    assert.match(calls.rawSql[0]!, /cr\.id/);
  });

  it('sin creditId también se agrega (cliente a visitar sin crédito elegido)', async () => {
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: [] });
    const stop = await service.addStop('r1', { clientId: 'cl9' } as never);
    assert.equal(stop.sequenceOrder, 1);
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

  it('saltar una parada sigue funcionando y queda auditado', async () => {
    const { service, calls } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    const res = await service.updateStop('r1', 's2', { status: 'SKIPPED' } as never);
    assert.equal(res.status, 'SKIPPED');
    assert.ok(calls.audit.includes('UPDATE'));
  });

  it('🔴 no se marca VISITED a secas: se visita registrando la visita (ROUTE_STOP_TRANSITION)', async () => {
    // Marcarla a secas dejaba la gestión sin hacer, sin GPS ni resultado, y sin cerrar la agenda.
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops: threeStops() });
    await rejectsWithCode(service.updateStop('r1', 's2', { status: 'VISITED' } as never), 'ROUTE_STOP_TRANSITION');
  });

  it('una parada visitada no vuelve a pendiente', async () => {
    const stops = threeStops();
    stops[1]!.status = 'VISITED';
    const { service } = makeService({ route: OWN_ROUTE, permissions: FIELD, stops });
    await rejectsWithCode(service.updateStop('r1', 's2', { status: 'PENDING' } as never), 'ROUTE_STOP_TRANSITION');
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

  it('la parada sin coordenadas no se pierde ni se mueve de su lugar', async () => {
    const { service, order } = makeService({
      route: OWN_ROUTE,
      permissions: FIELD,
      stops: [
        ...threeStops(),
        { id: 's4', routeId: 'r1', clientId: 'cl4', creditId: 'cr4', sequenceOrder: 4, status: 'PENDING' },
      ],
      // s2 no tiene punto: no entra al cálculo, pero sigue siendo una parada del recorrido.
      points: { s1: THREE_POINTS.s1, s2: null, s3: THREE_POINTS.s3, s4: { latitude: -17.74, longitude: -63.21 } },
      osrm: {
        route: async () => fakePath(12.4, 45),
        trip: async () => ({ ...fakePath(9.9, 30), order: [0, 2, 1] }), // s1, s4, s3
      } as never,
    });
    await service.optimize('r1');
    // F4/12: las paradas que no se pueden mover (aquí, la que no tiene punto) conservan SU lugar; el orden sugerido
    // solo reparte los lugares que quedan entre las demás.
    assert.deepEqual(order(), ['s1', 's2', 's4', 's3']);
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

describe('RoutesService.list (período)', () => {
  const ASSIGN_ONLY = ['route:read', 'route:assign'];

  it('un rango pide los dos extremos, inclusivos', async () => {
    const { service, calls } = makeService({ permissions: ASSIGN_ONLY, routes: [] });
    await service.list({ from: '2026-08-12', to: '2026-08-18' } as never);
    const range = calls.listWhere!.plannedDate as { gte: Date; lte: Date };
    assert.equal(range.gte.toISOString().slice(0, 10), '2026-08-12');
    // `lte` con el mismo día lo incluye: `planned_date` es un día civil, no un instante.
    assert.equal(range.lte.toISOString().slice(0, 10), '2026-08-18');
  });

  it('medio rango también sirve (desde una fecha, sin tope)', async () => {
    const { service, calls } = makeService({ permissions: ASSIGN_ONLY, routes: [] });
    await service.list({ from: '2026-08-12' } as never);
    const range = calls.listWhere!.plannedDate as { gte?: Date; lte?: Date };
    assert.ok(range.gte);
    assert.equal(range.lte, undefined);
  });

  it('🔴 el día exacto GANA sobre el rango: es lo que pide el teléfono', async () => {
    // El móvil manda `date` y tiene que recibir ese día. Si el rango pisara, una app vieja que
    // mandara los dos empezaría a recibir una semana entera sin haber cambiado una línea.
    const { service, calls } = makeService({ permissions: ASSIGN_ONLY, routes: [] });
    await service.list({ date: '2026-08-20', from: '2026-08-01', to: '2026-08-31' } as never);
    assert.ok(calls.listWhere!.plannedDate instanceof Date);
  });
});

describe('RoutesService.list (orden)', () => {
  const ASSIGN = ['route:read', 'route:assign'];

  it('por defecto: fecha descendente, y el desempate SIEMPRE termina en id', async () => {
    // Once cobradores comparten el mismo día. Sin desempate estable, `LIMIT/OFFSET` repite una fila
    // en la página 1 y se saltea otra en la 2.
    const { service, calls } = makeService({ permissions: ASSIGN, routes: [] });
    await service.list({} as never);
    assert.deepEqual(calls.listOrderBy, [{ plannedDate: 'desc' }, { id: 'asc' }]);
  });

  it('por estado ordena por estado, pero adentro sigue mandando la fecha', async () => {
    const { service, calls } = makeService({ permissions: ASSIGN, routes: [] });
    await service.list({ sort: 'status', dir: 'asc' } as never);
    assert.deepEqual(calls.listOrderBy, [{ status: 'asc' }, { plannedDate: 'desc' }, { id: 'asc' }]);
  });

  it('🔴 por cobrador ordena por NOMBRE, no por el uuid', async () => {
    // Ordenar por `collector_id` agrupa a cada persona pero el orden entre personas es azar: la
    // flecha diría «alfabético» sobre algo que no lo es.
    const routes = [
      { id: 'rA', collectorId: 'u-zeballos', plannedDate: new Date('2026-08-20'), status: 'PLANNED', totalCases: 1, createdAt: new Date() },
      { id: 'rB', collectorId: 'u-colque', plannedDate: new Date('2026-08-20'), status: 'PLANNED', totalCases: 1, createdAt: new Date() },
      { id: 'rC', collectorId: 'u-camacho', plannedDate: new Date('2026-08-20'), status: 'PLANNED', totalCases: 1, createdAt: new Date() },
    ];
    const profiles = [
      { userId: 'u-zeballos', firstName: 'María', lastName: 'Zeballos' },
      // Con acento a propósito: sin normalizar, «Édgar Colque» cae DESPUÉS de «Zeballos».
      { userId: 'u-colque', firstName: 'Édgar', lastName: 'Colque' },
      { userId: 'u-camacho', firstName: 'Ana', lastName: 'Camacho' },
    ];
    const { service } = makeService({ permissions: ASSIGN, routes, profiles });

    const asc = await service.list({ sort: 'collector', dir: 'asc' } as never);
    assert.deepEqual(asc.data!.map((r) => r.id), ['rC', 'rB', 'rA']);

    const desc = await service.list({ sort: 'collector', dir: 'desc' } as never);
    assert.deepEqual(desc.data!.map((r) => r.id), ['rA', 'rB', 'rC']);
  });

  it('quien no tiene perfil va al final, en los dos sentidos', async () => {
    // No es «el primero alfabéticamente»: es que no se sabe cómo se llama.
    const routes = [
      { id: 'r1', collectorId: 'u-sin-perfil', plannedDate: new Date('2026-08-20'), status: 'PLANNED', totalCases: 1, createdAt: new Date() },
      { id: 'r2', collectorId: 'u-camacho', plannedDate: new Date('2026-08-20'), status: 'PLANNED', totalCases: 1, createdAt: new Date() },
    ];
    const profiles = [{ userId: 'u-camacho', firstName: 'Ana', lastName: 'Camacho' }];
    const { service } = makeService({ permissions: ASSIGN, routes, profiles });

    assert.deepEqual((await service.list({ sort: 'collector', dir: 'asc' } as never)).data!.map((r) => r.id), ['r2', 'r1']);
    assert.deepEqual((await service.list({ sort: 'collector', dir: 'desc' } as never)).data!.map((r) => r.id), ['r2', 'r1']);
  });
});

describe('RoutesService.list (paradas visitadas)', () => {
  it('🔴 cuenta las visitadas de cada ruta: sin esto la pantalla sólo puede decir «8», no «2 de 3»', async () => {
    const stops: FakeStop[] = [
      { id: 's1', routeId: 'r1', creditId: 'c1', sequenceOrder: 1, status: 'VISITED' },
      { id: 's2', routeId: 'r1', creditId: 'c2', sequenceOrder: 2, status: 'VISITED' },
      { id: 's3', routeId: 'r1', creditId: 'c3', sequenceOrder: 3, status: 'PENDING' },
      { id: 's4', routeId: 'r2', creditId: 'c4', sequenceOrder: 1, status: 'PENDING' },
    ];
    const routes = [
      { id: 'r1', collectorId: 'u1', plannedDate: new Date('2026-08-20'), status: 'COMPLETED', totalCases: 3, createdAt: new Date() },
      { id: 'r2', collectorId: 'u2', plannedDate: new Date('2026-08-20'), status: 'PLANNED', totalCases: 1, createdAt: new Date() },
    ];
    const { service } = makeService({ permissions: ['route:read', 'route:assign'], routes, stops });

    const res = await service.list({} as never);
    assert.equal(res.data![0]!.visitedCount, 2);
    // Una ruta sin ninguna visitada vale CERO, no `undefined`: «0 de 1» es un dato, y un hueco no.
    assert.equal(res.data![1]!.visitedCount, 0);
  });
});

describe('RoutesService idempotente por id (cola offline)', () => {
  const RID = '5f2504e0-4f89-41d3-9a0c-0305e82c3303';
  const PRIOR = { id: RID, collectorId: 'u1', plannedDate: new Date('2026-08-12'), status: 'PLANNED', totalCases: 1, createdAt: new Date(), stops: [] };

  it('create con id existente: devuelve la ruta, sin crear otra ni auditar, aunque ya haya ruta ese día', async () => {
    const { service, calls } = makeService({ permissions: ['route:execute'], priorRoute: PRIOR, routeOfDay: { id: RID } });
    const r = await service.create({ ...GEN, id: RID } as never);
    assert.equal(r.id, RID);
    assert.equal(calls.routeCreate.length, 0);
    assert.equal(calls.audit.length, 0);
  });

  it('generate con id existente: devuelve la ruta, sin segunda ruta ni paradas', async () => {
    const { service, calls } = makeService({ permissions: ['route:execute'], priorRoute: PRIOR, routeOfDay: { id: RID } });
    const r = await service.generate({ ...GEN, id: RID } as never);
    assert.equal(r.id, RID);
    assert.equal(calls.routeCreate.length, 0);
    assert.equal(calls.audit.length, 0);
  });

  it('id de la ruta de otro cobrador: 409 ROUTE_ID', async () => {
    const { service } = makeService({ permissions: ['route:execute'], priorRoute: { ...PRIOR, collectorId: 'otro' } });
    await rejectsWithCode(service.create({ ...GEN, id: RID } as never), 'ROUTE_ID');
    await rejectsWithCode(service.generate({ ...GEN, id: RID } as never), 'ROUTE_ID');
  });

  it('id nuevo: crea la ruta con ESE id', async () => {
    const { service, calls } = makeService({ permissions: ['route:execute'] });
    await service.create({ ...GEN, id: RID } as never);
    assert.equal(calls.routeCreate[0]!.id, RID);
  });

  it('carrera en create: reintenta una vez y devuelve la ruta ganadora', async () => {
    const { service, calls } = makeService({ permissions: ['route:execute'], routeRace: true, priorRoute: PRIOR });
    const r = await service.create({ ...GEN, id: RID } as never);
    assert.equal(r.id, RID);
    assert.equal(calls.routeCreate.length, 0);
    assert.equal(calls.audit.length, 0);
  });
});

// ── F4/12 · máquina de estados, autoría y motivos ────────────────────────────────────────────────────

describe('RoutesService.updateStatus · máquina de estados (F4/12)', () => {
  const MINE = { id: 'r1', collectorId: 'u1', createdBy: 'u1' };
  const FIELD_ONLY = ['route:read', 'route:execute'];
  const stopsOf = (...st: string[]): FakeStop[] =>
    st.map((status, i) => ({ id: `s${i + 1}`, routeId: 'r1', clientId: `cl${i + 1}`, sequenceOrder: i + 1, status }));

  it('iniciar: PLANIFICADA → EN CURSO, con la hora de inicio y condicionado al estado leído', async () => {
    const { service, calls } = makeService({ route: MINE, permissions: FIELD_ONLY, stops: stopsOf('PENDING') });
    const r = await service.updateStatus('r1', { status: 'IN_PROGRESS' } as never);
    assert.equal(r.status, 'IN_PROGRESS');
    assert.ok(calls.routeUpdate[0]!.startedAt instanceof Date);
    assert.equal(calls.routeUpdateWhere[0]!.status, 'PLANNED', 'WHERE status = el leído: dos personas a la vez no se pisan');
  });

  it('🔴 pedir el estado en que ya está es un reintento: no cambia nada ni repite el evento', async () => {
    const { service, calls } = makeService({ route: { ...MINE, status: 'COMPLETED' }, permissions: FIELD_ONLY });
    const r = await service.updateStatus('r1', { status: 'COMPLETED' } as never);
    assert.equal(r.status, 'COMPLETED');
    assert.equal(calls.routeUpdate.length, 0);
    assert.equal(calls.events.length, 0, 'sin segundo route.completed ni segunda notificación a supervisores');
    assert.equal(calls.audit.length, 0);
  });

  it('🔴 una ruta cerrada no se reabre y no se completa lo que nunca se inició (ROUTE_TRANSITION)', async () => {
    const closed = makeService({ route: { ...MINE, status: 'COMPLETED' }, permissions: FIELD_ONLY });
    await rejectsWithCode(closed.service.updateStatus('r1', { status: 'PLANNED' } as never), 'ROUTE_TRANSITION');
    await rejectsWithCode(closed.service.updateStatus('r1', { status: 'IN_PROGRESS' } as never), 'ROUTE_TRANSITION');
    const planned = makeService({ route: MINE, permissions: FIELD_ONLY });
    await rejectsWithCode(planned.service.updateStatus('r1', { status: 'COMPLETED' } as never), 'ROUTE_TRANSITION');
    assert.equal(planned.calls.routeUpdate.length, 0);
  });

  it('otra persona cambió la ruta mientras tanto: ROUTE_STATE_CHANGED, no se pisa', async () => {
    const { service } = makeService({ route: MINE, permissions: FIELD_ONLY, statusRace: true });
    await rejectsWithCode(service.updateStatus('r1', { status: 'IN_PROGRESS' } as never), 'ROUTE_STATE_CHANGED');
  });

  it('completar con paradas sin gestionar EXIGE el motivo; con motivo, esas paradas quedan SALTADAS', async () => {
    const mgr = makeService({ route: { ...MINE, status: 'IN_PROGRESS' }, permissions: ['route:read', 'route:write'], stops: stopsOf('VISITED', 'PENDING', 'PENDING') });
    await rejectsWithCode(mgr.service.updateStatus('r1', { status: 'COMPLETED' } as never), 'ROUTE_REASON_REQUIRED');
    await rejectsWithCode(mgr.service.updateStatus('r1', { status: 'COMPLETED', reason: '  ' } as never), 'ROUTE_REASON_REQUIRED');
    assert.equal(mgr.calls.routeUpdate.length, 0);

    const ok = makeService({ route: { ...MINE, status: 'IN_PROGRESS' }, permissions: ['route:read', 'route:assign', 'route:execute'], stops: stopsOf('VISITED', 'PENDING', 'PENDING') });
    await ok.service.updateStatus('r1', { status: 'COMPLETED', reason: 'Se acabó el tiempo; sigo mañana' } as never);
    assert.equal(ok.calls.routeUpdate[0]!.statusReason, 'Se acabó el tiempo; sigo mañana');
    assert.deepEqual(ok.calls.stopUpdateMany[0]!.data, { status: 'SKIPPED' });
    assert.deepEqual((ok.calls.stopUpdateMany[0]!.where.id as { in: string[] }).in, ['s2', 's3'], 'la visitada no se toca');
    assert.deepEqual(ok.calls.events, ['route.completed']);
  });

  it('el cobrador que cierra SU ruta no necesita mandar motivo (compat con el móvil de hoy); sin pendientes tampoco', async () => {
    const withPending = makeService({ route: { ...MINE, status: 'IN_PROGRESS' }, permissions: FIELD_ONLY, stops: stopsOf('VISITED', 'PENDING') });
    await withPending.service.updateStatus('r1', { status: 'COMPLETED' } as never);
    assert.equal(withPending.calls.routeUpdate[0]!.statusReason, 'Cerrada con paradas sin gestionar.');
    const clean = makeService({ route: { ...MINE, status: 'IN_PROGRESS' }, permissions: ['route:read', 'route:write'], stops: stopsOf('VISITED', 'SKIPPED') });
    await clean.service.updateStatus('r1', { status: 'COMPLETED' } as never);
    assert.equal(clean.calls.stopUpdateMany.length, 0);
  });

  it('cancelar exige el motivo y salta las paradas sin gestionar', async () => {
    const { service, calls } = makeService({ route: MINE, permissions: FIELD_ONLY, stops: stopsOf('PENDING', 'PENDING') });
    await rejectsWithCode(service.updateStatus('r1', { status: 'CANCELLED' } as never), 'ROUTE_REASON_REQUIRED');
    await service.updateStatus('r1', { status: 'CANCELLED', reason: 'Me enfermé' } as never);
    assert.equal(calls.routeUpdate[0]!.statusReason, 'Me enfermé');
    assert.ok(calls.routeUpdate[0]!.cancelledAt instanceof Date);
    assert.equal(calls.events.includes('route.completed'), false);
  });

  it('🔴 con visitas registradas no se cancela: se completa (ROUTE_HAS_VISITS)', async () => {
    const { service, calls } = makeService({ route: { ...MINE, status: 'IN_PROGRESS' }, permissions: FIELD_ONLY, visitCount: 2, stops: stopsOf('VISITED', 'PENDING') });
    await rejectsWithCode(service.updateStatus('r1', { status: 'CANCELLED', reason: 'Quiero cancelar' } as never), 'ROUTE_HAS_VISITS');
    assert.equal(calls.routeUpdate.length, 0);
  });

  it('🔴 quien no armó la ruta ni la anda no la cancela directo: la pide (ROUTE_REQUEST_REQUIRED)', async () => {
    // La armó otro manager y el cobrador es otra persona: este manager solo puede pedirlo.
    const { service, calls } = makeService({ route: { id: 'r1', collectorId: 'u9', createdBy: 'u8' }, permissions: ['route:read', 'route:assign'], stops: stopsOf('PENDING') });
    await rejectsWithCode(service.updateStatus('r1', { status: 'CANCELLED', reason: 'Quiero cancelarla ya' } as never), 'ROUTE_REQUEST_REQUIRED');
    assert.equal(calls.routeUpdate.length, 0);
  });

  it('un manager ajeno puede iniciar o completar, pero deja el motivo', async () => {
    const { service } = makeService({ route: { id: 'r1', collectorId: 'u9', createdBy: 'u8' }, permissions: ['route:read', 'route:assign'], stops: stopsOf('PENDING') });
    await rejectsWithCode(service.updateStatus('r1', { status: 'IN_PROGRESS' } as never), 'ROUTE_REASON_REQUIRED');
    await service.updateStatus('r1', { status: 'IN_PROGRESS', reason: 'El cobrador no tiene señal; la inicio yo' } as never);
  });

  it('cancelar avisa al cobrador y a quien armó la ruta (no a quien la cancela)', async () => {
    const { service, calls } = makeService({ route: { id: 'r1', collectorId: 'u9', createdBy: 'u8', plannedDate: new Date('2026-06-20') }, permissions: ['route:read', 'route:assign', 'route:execute'], stops: stopsOf('PENDING') });
    await service.updateStatus('r1', { status: 'CANCELLED', reason: 'Cambio de zona' } as never);
    assert.equal(calls.events.filter((e) => e === 'route.notice').length, 2);
  });
});

describe('RoutesService · autoría y ruta cerrada (F4/12)', () => {
  const stopsOf = (...st: string[]): FakeStop[] =>
    st.map((status, i) => ({ id: `s${i + 1}`, routeId: 'r1', clientId: `cl${i + 1}`, sequenceOrder: i + 1, status }));

  it('🔴 quien no armó la ruta no agrega, quita ni mueve paradas: las pide (ROUTE_REQUEST_REQUIRED)', async () => {
    // El cobrador de una ruta que armó el manager tampoco la edita directo.
    const route = { id: 'r1', collectorId: 'u1', createdBy: 'manager-1' };
    const { service, stops } = makeService({ route, permissions: ['route:read', 'route:execute'], stops: stopsOf('PENDING', 'PENDING') });
    await rejectsWithCode(service.addStop('r1', { clientId: 'c1' } as never), 'ROUTE_REQUEST_REQUIRED');
    await rejectsWithCode(service.removeStop('r1', 's1'), 'ROUTE_REQUEST_REQUIRED');
    await rejectsWithCode(service.updateStop('r1', 's1', { sequenceOrder: 2 } as never), 'ROUTE_REQUEST_REQUIRED');
    assert.equal(stops.length, 2, 'no se tocó nada');
  });

  it('quien armó la ruta sí la edita; el administrador también', async () => {
    const route = { id: 'r1', collectorId: 'u9', createdBy: 'u1' };
    const mine = makeService({ route, permissions: ['route:read', 'route:assign'], stops: stopsOf('PENDING') });
    await mine.service.removeStop('r1', 's1');
    const admin = makeService({ route: { ...route, createdBy: 'otro' }, permissions: ['route:read', 'route:assign', 'route:execute'], stops: stopsOf('PENDING') });
    await admin.service.removeStop('r1', 's1');
  });

  it('una ruta anterior a F4/12 (sin creador) se rige como siempre: quien administra rutas y su cobrador', async () => {
    const legacy = { id: 'r1', collectorId: 'u1', createdBy: null };
    const manager = makeService({ route: legacy, permissions: ['route:read', 'route:write'], stops: stopsOf('PENDING') });
    await manager.service.removeStop('r1', 's1');
    const collector = makeService({ route: legacy, permissions: ['route:read', 'route:execute'], stops: stopsOf('PENDING') });
    await collector.service.removeStop('r1', 's1');
  });

  it('🔴 una ruta cerrada no se modifica (ROUTE_CLOSED)', async () => {
    for (const status of ['COMPLETED', 'CANCELLED']) {
      const { service } = makeService({ route: { id: 'r1', collectorId: 'u1', createdBy: 'u1', status }, permissions: ['route:read', 'route:execute'], stops: stopsOf('PENDING', 'PENDING') });
      await rejectsWithCode(service.addStop('r1', { clientId: 'c1' } as never), 'ROUTE_CLOSED');
      await rejectsWithCode(service.removeStop('r1', 's1'), 'ROUTE_CLOSED');
      await rejectsWithCode(service.updateStop('r1', 's1', { sequenceOrder: 2 } as never), 'ROUTE_CLOSED');
    }
  });

  it('la ruta nace con su creador, y no se arma para un día que ya pasó (ROUTE_PAST_DATE)', async () => {
    const ok = makeService({ permissions: ['route:read', 'route:assign'], today: '2026-06-20' });
    await ok.service.create({ collectorId: COLLECTOR_ID, plannedDate: '2026-06-20' } as never);
    assert.equal(ok.calls.routeCreate[0]!.createdBy, 'u1');
    const past = makeService({ permissions: ['route:read', 'route:assign'], today: '2026-06-21' });
    await rejectsWithCode(past.service.create({ collectorId: COLLECTOR_ID, plannedDate: '2026-06-20' } as never), 'ROUTE_PAST_DATE');
    assert.equal(past.calls.routeCreate.length, 0);
  });

  it('un reintento por id de una ruta ya creada no se rechaza por la fecha', async () => {
    // La cola offline puede reenviar pasada la medianoche: la ruta ya existe, se devuelve.
    const { service } = makeService({ permissions: ['route:read', 'route:assign'], today: '2026-06-25', priorRoute: { id: 'r1', collectorId: COLLECTOR_ID, stops: [] } });
    const r = await service.create({ id: 'r1', collectorId: COLLECTOR_ID, plannedDate: '2026-06-20' } as never);
    assert.equal(r.id, 'r1');
  });

  it('con ubicación pedida: debe ser del cliente y tener punto; sin ella, se guarda la principal', async () => {
    const loc = (id: string, clientId: string, point = true) => ({ id, clientId, locationType: 'HOME', relationId: null, latitude: point ? -16.5 : null, longitude: point ? -68.1 : null });
    const wrong = makeService({ credits: [{ id: 'crA', client_id: 'cl-crA' }], permissions: ASSIGN, locations: [loc('L1', 'otro-cliente')] });
    await rejectsWithCode(wrong.service.generate({ ...GEN, creditIds: ['crA'], locations: { crA: 'L1' } } as never), 'RESOURCE_NOT_FOUND');
    const noPoint = makeService({ credits: [{ id: 'crA', client_id: 'cl-crA' }], permissions: ASSIGN, locations: [loc('L1', 'cl-crA', false)] });
    await rejectsWithCode(noPoint.service.generate({ ...GEN, creditIds: ['crA'], locations: { crA: 'L1' } } as never), 'ROUTE_STOP_NO_POINT');
    const fine = makeService({ credits: [{ id: 'crA', client_id: 'cl-crA' }], permissions: ASSIGN, locations: [loc('L1', 'cl-crA')] });
    await fine.service.generate({ ...GEN, creditIds: ['crA'] } as never);
    const stops = (fine.calls.routeCreate[0]!.stops as { create: { locationId: string | null }[] }).create;
    assert.equal(stops[0]!.locationId, 'L1', 'sin elegir, la principal del cliente queda guardada en la parada');
  });

  it('con requirePoints, una parada sin punto frena la publicación y dice cuáles faltan', async () => {
    const { service } = makeService({
      credits: [{ id: 'crA', client_id: 'cl-crA' }],
      permissions: ASSIGN,
      locations: [{ id: 'L1', clientId: 'cl-crA', locationType: 'HOME', relationId: null, latitude: null, longitude: null }],
    });
    await rejectsWithCode(service.generate({ ...GEN, creditIds: ['crA'], requirePoints: true } as never), 'ROUTE_STOP_NO_POINT');
  });

  it('el detalle dice qué puede hacer quien mira', async () => {
    const { service } = makeService({ route: { id: 'r1', collectorId: 'u1', createdBy: 'u1', status: 'PLANNED' }, permissions: ['route:read', 'route:execute'], stops: stopsOf('PENDING') });
    const r = await service.findOne('r1');
    assert.equal(r.capabilities.edit, true);
    assert.equal(r.capabilities.start, true);
    assert.equal(r.capabilities.cancel, true);
    assert.equal(r.capabilities.complete, false, 'no se completa lo que no se inició');
    const other = makeService({ route: { id: 'r1', collectorId: 'u9', createdBy: 'u8', status: 'PLANNED' }, permissions: ['route:read', 'route:assign'], stops: stopsOf('PENDING') });
    const o = await other.service.findOne('r1');
    assert.equal(o.capabilities.edit, false);
    assert.equal(o.capabilities.requestChange, true);
    assert.equal(o.capabilities.cancel, false);
  });
});

// ── F4/12 · vista previa de un recorrido que todavía no existe ───────────────────────────────────────

describe('RoutesService.previewPoints · antes de publicar (F4/12)', () => {
  const P = (id: string, lat: number, extra: Record<string, unknown> = {}) => ({ id, latitude: lat, longitude: -68.1, ...extra });
  const pts = { points: [P('a', -16.5), P('b', -16.6), P('c', -16.7)] } as never;
  const MANAGER = ['route:read', 'route:assign'];

  it('devuelve recorrido, distancia, duración y hora de llegada a cada punto, SIN guardar nada', async () => {
    const { service, calls } = makeService({
      permissions: MANAGER,
      osrm: { route: async () => fakePath(12.4, 45), trip: async () => null } as never,
    });
    const r = await service.previewPoints(pts);
    assert.equal(r.distanceKm, 12.4);
    // 45 min de calle + 10 de permanencia en cada una de las 3 paradas.
    assert.equal(r.minutes, 75);
    // Cada tramo son 23 min (la mitad de 45, redondeada) más los 10 de permanencia en la parada anterior.
    assert.deepEqual(r.stops.map((s) => s.etaMinutes), [0, 33, 66]);
    assert.equal(calls.routeCreate.length + calls.routeUpdate.length, 0, 'no escribe nada');
    assert.equal(calls.audit.length, 0, 'ni audita: no revela datos personales');
  });

  it('sugiere un orden mejor cuando ahorra de verdad, igual que la ruta ya armada', async () => {
    const { service } = makeService({
      permissions: MANAGER,
      osrm: { route: async () => fakePath(12.4, 45), trip: async () => ({ ...fakePath(9.9, 30), order: [0, 2, 1] }) } as never,
    });
    const r = await service.previewPoints(pts);
    assert.deepEqual(r.suggestion!.order, ['a', 'c', 'b']);
    assert.equal(r.suggestion!.savedKm, 2.5);
  });

  it('🔴 con una hora fija, la sugerencia no mueve esa parada de su lugar', async () => {
    const fixed = { points: [P('a', -16.5), P('b', -16.6, { scheduledTime: '10:30' }), P('c', -16.7)] } as never;
    const { service } = makeService({
      permissions: MANAGER,
      osrm: { route: async () => fakePath(12.4, 45), trip: async () => ({ ...fakePath(9.9, 30), order: [0, 2, 1] }) } as never,
    });
    const r = await service.previewPoints(fixed);
    // «b» tiene hora fija (2.ª): sola queda una parada movible, así que no hay nada que reordenar.
    assert.equal(r.suggestion, undefined);
    assert.equal(r.stops[1]!.scheduledTime, '10:30', 'y la hora viaja para que la pantalla marque el choque');
  });

  it('sin motor de ruteo se degrada: sin distancia inventada', async () => {
    const { service } = makeService({ permissions: MANAGER });
    const r = await service.previewPoints(pts);
    assert.deepEqual(r.geometry, []);
    assert.equal(r.distanceKm, undefined);
    assert.equal(r.stops.length, 3);
  });

  it('un solo punto no tiene recorrido que calcular', async () => {
    const { service } = makeService({ permissions: MANAGER });
    const r = await service.previewPoints({ points: [P('a', -16.5)] } as never);
    assert.equal(r.distanceKm, undefined);
    assert.equal(r.stops.length, 1);
  });

  it('un auditor no previsualiza rutas (403); el cobrador sí (arma la suya)', async () => {
    const auditor = makeService({ permissions: ['route:read'] });
    await rejectsWithCode(auditor.service.previewPoints(pts), 'AUTH_002');
    const collector = makeService({ permissions: ['route:read', 'route:execute'] });
    await collector.service.previewPoints(pts);
  });
});

// ── Botón «dónde estoy» de los mapas: el camino entre dos puntos ─────────────────────────────────────

describe('RoutesService.leg · de dónde estoy a una parada', () => {
  const dto = { from: { id: 'yo', latitude: -16.5, longitude: -68.1 }, to: { id: 'p', latitude: -16.6, longitude: -68.1 } } as never;

  it('devuelve el camino, la distancia y los minutos de calle, sin sumar permanencia', async () => {
    const { service, calls } = makeService({
      permissions: ['route:read', 'route:execute'],
      osrm: { route: async () => fakePath(3.24, 12) } as never,
    });
    const r = await service.leg(dto);
    assert.equal(r!.distanceKm, 3.2);
    assert.equal(r!.minutes, 12);
    assert.equal(calls.audit.length, 0, 'no audita: no revela datos personales');
  });

  it('sin motor de ruteo devuelve null, sin inventar un camino', async () => {
    const { service } = makeService({ permissions: ['route:read', 'route:execute'] });
    assert.equal(await service.leg(dto), null);
  });

  it('un auditor no calcula caminos (403)', async () => {
    const { service } = makeService({ permissions: ['route:read'] });
    await rejectsWithCode(service.leg(dto), 'AUTH_002');
  });
});
