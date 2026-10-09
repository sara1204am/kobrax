import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FieldService } from './field.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(
  opts: {
    visit?: unknown;
    stop?: unknown;
    /** `$queryRaw` de alcance: los créditos visibles. `false` = fuera de alcance. */
    visibleCredit?: false;
    category?: unknown;
    permissions?: string[];
    listRows?: Record<string, unknown>[];
    /** createVisit: visita que ya existe con el id del cliente (reintento). */
    priorVisit?: Record<string, unknown> | null;
    /** createVisit: la 1ª creación choca con la PK y la 2ª encuentra al ganador. */
    visitRace?: boolean;
    /** La parada ya tiene visitas registradas (`fieldVisit.count`). */
    existingVisits?: number;
    /** Otras paradas activas que ya llevan la misma visita agendada. */
    otherStopsOnAgenda?: number;
    /** La evidencia con ese hash ya estaba (reintento de la cola). */
    priorEvidence?: Record<string, unknown> | null;
    /** El día «de la empresa» (zona) con que se filtran las visitas por fecha. */
    timezone?: string;
  } = {},
) {
  let raced = false;
  const calls = {
    visitCreate: [] as Record<string, unknown>[],
    stopUpdate: 0,
    stopUpdateData: [] as Record<string, unknown>[],
    activities: 0,
    activityData: [] as Record<string, unknown>[],
    agendaUpdates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    creditUpdates: [] as Record<string, unknown>[],
    scopeQueries: 0,
    evidence: [] as Record<string, unknown>[],
    events: [] as string[],
    audit: [] as { entity: string; action: string }[],
    alerts: [] as string[],
    listWhere: undefined as Record<string, unknown> | undefined,
    listOrderBy: undefined as Record<string, unknown>[] | undefined,
  };
  const tx = {
    $queryRaw: async () => {
      calls.scopeQueries += 1;
      return opts.visibleCredit === false ? [] : [{ id: 'cr1', client_id: 'cl1' }];
    },
    creditArrearEpisode: { findFirst: async () => ({ id: 'ep1' }) },
    credit: { update: async (a: { data: Record<string, unknown> }) => { calls.creditUpdates.push(a.data); return {}; } },
    // F4/12: la parada trae su ruta (de ahí sale quién manda) y se cuentan las demás paradas que llevan la misma visita.
    routeStop: {
      findFirst: async () => ({ id: 's1', status: 'PENDING', creditId: null, agendaItemId: null, locationId: null, route: { collectorId: 'collector-1', createdBy: null, status: 'IN_PROGRESS' }, ...(opts.stop as object | undefined) }),
      count: async () => opts.otherStopsOnAgenda ?? 0,
      update: async (a: { data: Record<string, unknown> }) => { calls.stopUpdate += 1; calls.stopUpdateData.push(a.data); return {}; },
    },
    creditActivity: { create: async (a: { data: Record<string, unknown> }) => { calls.activities += 1; calls.activityData.push(a.data); return { id: 'act-1' }; } },
    agendaItem: { updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { calls.agendaUpdates.push(a); return { count: 1 }; } },
    user: { update: async () => ({}) },
    fieldVisit: {
      findFirst: async (args?: { where?: { id?: string } }) => {
        // `createVisit` con id pregunta por ESE id; el resto de las lecturas piden la visita de siempre.
        if (opts.visitRace && args?.where?.id === 'dup-id') return raced ? opts.priorVisit : null;
        if (args?.where?.id === 'dup-id' || args?.where?.id === 'new-id') return opts.priorVisit ?? null;
        if (args?.where?.id === 'v-ajena') return null; // la visita que se dice corregir no es de esa parada
        return opts.visit ?? { id: 'v1', latitude: -16.5, longitude: -68.15, collectorId: 'collector-1', registeredBy: null };
      },
      findMany: async (args: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>[] }) => {
        calls.listWhere = args.where;
        calls.listOrderBy = args.orderBy;
        return opts.listRows ?? [];
      },
      count: async (a?: { where?: { routeStopId?: string } }) => (a?.where?.routeStopId ? (opts.existingVisits ?? 0) : (opts.listRows?.length ?? 0)),
      create: async (args: { data: Record<string, unknown> }) => {
        if (opts.visitRace && !raced) {
          raced = true;
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        calls.visitCreate.push(args.data);
        return { id: 'v1', ...args.data };
      },
    },
    fieldEvidence: {
      findFirst: async () => opts.priorEvidence ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.evidence.push(args.data);
        return { id: 'e1', ...args.data };
      },
    },
    // Catálogo del tenant: sólo lo consulta la gestión especial (S5). `null` = categoría inexistente.
    catalogItem: { findFirst: async () => ('category' in opts ? opts.category : { id: 'cat-1' }) },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  // Por defecto un cobrador: la mayoría de estas pruebas registran visitas, y registrar exige ejecutar o administrar rutas.
  const perms = opts.permissions ?? ['route:read', 'route:execute'];
  const tenant = { accountId: 'acc-A', userId: 'collector-1', permissions: perms, can: (p: string) => perms.includes(p) };
  const audit = {
    record: async (e: { action: string; entity: string }) => void calls.audit.push({ entity: e.entity, action: e.action }),
  };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const alerts = { check: async (kind: string) => void calls.alerts.push(kind) };
  const clock = { timezone: async () => opts.timezone ?? 'UTC' };
  const service = new FieldService(prisma as never, tenant as never, audit as never, events as never, alerts as never, clock as never);
  return { service, calls };
}

const ROW = {
  id: 'v1',
  creditId: 'cr1',
  routeStopId: 's1',
  collectorId: 'collector-1',
  latitude: -16.5,
  longitude: -68.15,
  accuracy: 12.5,
  outcome: 'CONTACTED',
  notes: null,
  details: {},
  capturedAt: new Date('2026-08-12T14:30:00.000Z'),
};

describe('FieldService.list (lectura de visitas — W6 T0)', () => {
  it('el cobrador (ROUTE_EXECUTE sin ROUTE_ASSIGN) queda acotado a lo suyo, ignorando lo que pida', async () => {
    const { service, calls } = makeService({ permissions: ['route:read', 'route:execute'] });
    await service.list({ collectorId: 'otro' } as never);
    assert.equal(calls.listWhere!.collectorId, 'collector-1');
  });

  it('con ROUTE_ASSIGN respeta el cobrador pedido', async () => {
    const { service, calls } = makeService({ permissions: ['route:read', 'route:assign'] });
    await service.list({ collectorId: 'otro' } as never);
    assert.equal(calls.listWhere!.collectorId, 'otro');
  });

  it('un auditor (ROUTE_READ a secas) ve todo el tenant, no sólo lo suyo', async () => {
    const { service, calls } = makeService({ permissions: ['route:read'] });
    await service.list({} as never);
    assert.equal(calls.listWhere!.collectorId, undefined);
  });

  it('🔴 y el auditor SÍ puede filtrar por cobrador', async () => {
    // El filtro vivía dentro de la rama de ROUTE_ASSIGN: un auditor pedía `?collectorId=x` y
    // recibía todo el tenant creyendo que miraba a una persona, sin nada que avisara.
    const { service, calls } = makeService({ permissions: ['route:read'] });
    await service.list({ collectorId: 'u9' } as never);
    assert.equal(calls.listWhere!.collectorId, 'u9');
  });

  it('las visitas de una ruta se buscan por sus paradas, que es de donde cuelgan', async () => {
    const { service, calls } = makeService({ permissions: ['route:assign'] });
    await service.list({ routeId: 'r1' } as never);
    assert.deepEqual(calls.listWhere!.routeStop, { routeId: 'r1' });
  });

  it('las de una parada se piden por su id: una parada puede tener más de una visita', async () => {
    const { service, calls } = makeService({ permissions: ['route:assign'] });
    await service.list({ routeStopId: 's1' } as never);
    assert.equal(calls.listWhere!.routeStopId, 's1');
  });

  it('un día es el día entero en UTC, no un instante', async () => {
    const { service, calls } = makeService({ permissions: ['route:assign'] });
    await service.list({ date: '2026-08-12' } as never);
    const range = calls.listWhere!.capturedAt as { gte: Date; lt: Date };
    assert.equal(range.gte.toISOString(), '2026-08-12T00:00:00.000Z');
    assert.equal(range.lt.toISOString(), '2026-08-13T00:00:00.000Z');
  });

  it('🔴 el orden termina en id: en una ruta las visitas se registran seguidas', async () => {
    // Sin desempate único, dos visitas del mismo instante hacen que LIMIT/OFFSET repita y saltee.
    const { service, calls } = makeService({ permissions: ['route:assign'] });
    await service.list({} as never);
    assert.deepEqual(calls.listOrderBy, [{ capturedAt: 'desc' }, { id: 'asc' }]);
  });

  it('audita el revelado UNA vez por consulta, no una por fila, y bajo su propia entidad', async () => {
    // El punto de la visita dice dónde vive el deudor. Una entrada por fila llenaría el log.
    // Y la entidad es `field_visit_list`: el id de un revelado de listado es QUIÉN miró, no qué.
    const { service, calls } = makeService({ permissions: ['route:assign'], listRows: [ROW, { ...ROW, id: 'v2' }] });
    await service.list({} as never);
    assert.deepEqual(calls.audit, [{ entity: 'field_visit_list', action: 'PII_REVEAL' }]);
  });

  it('sin resultados no audita nada: no se reveló nada', async () => {
    const { service, calls } = makeService({ permissions: ['route:assign'] });
    await service.list({} as never);
    assert.deepEqual(calls.audit, []);
  });

  it('las coordenadas salen como número, no como el Decimal de Prisma', async () => {
    // Serializado a JSON, un Decimal viaja como string y el mapa del panel no dibujaría nada.
    const { service } = makeService({ permissions: ['route:assign'], listRows: [ROW] });
    const res = await service.list({} as never);
    assert.equal(typeof res.data![0]!.latitude, 'number');
    assert.equal(typeof res.data![0]!.accuracy, 'number');
  });
});

describe('FieldService.findOne (la visita con su evidencia)', () => {
  const WITH_EVIDENCE = {
    ...ROW,
    evidences: [
      {
        id: 'e1',
        type: 'PHOTO',
        fileUrl: '/api/uploads/abc123.jpg',
        fileHash: 'a'.repeat(64),
        latitude: -16.5,
        longitude: -68.15,
        capturedAt: new Date('2026-08-12T14:31:00.000Z'),
      },
    ],
  };

  it('devuelve la evidencia con el hash ENTERO: recortado sería decorativo', async () => {
    const { service } = makeService({ permissions: ['route:assign'], visit: WITH_EVIDENCE });
    const visit = await service.findOne('v1');
    assert.equal(visit.evidences[0]!.fileHash.length, 64);
    // `fileUrl` es la RUTA que devolvió `uploads`, no un nombre suelto: el panel la usa tal cual y
    // pega en su propio handler, que proxea con el Bearer.
    assert.equal(visit.evidences[0]!.fileUrl, '/api/uploads/abc123.jpg');
  });

  it('la visita de otro cobrador responde 404, no 403: no se filtra que exista', async () => {
    const { service } = makeService({
      permissions: ['route:read', 'route:execute'],
      visit: { ...WITH_EVIDENCE, collectorId: 'otro' },
    });
    await rejectsWithCode(service.findOne('v1'), 'RESOURCE_NOT_FOUND');
  });

  it('un auditor sí puede abrir la visita de cualquiera', async () => {
    const { service } = makeService({
      permissions: ['route:read'],
      visit: { ...WITH_EVIDENCE, collectorId: 'otro' },
    });
    assert.equal((await service.findOne('v1')).id, 'v1');
  });
});

describe('FieldService.createVisit', () => {
  it('exige un objetivo (crédito o parada)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.createVisit({ lat: -16.5, lng: -68.15, outcome: 'CONTACTED' as never }), 'VISIT_TARGET');
  });

  it('valida el GPS', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.createVisit({ creditId: 'cr1', lat: 999, lng: 0, outcome: 'CONTACTED' as never } as never), 'VISIT_GPS');
  });

  it('registra la visita, marca la parada y emite collector.location', async () => {
    const { service, calls } = makeService();
    const r = await service.createVisit({ routeStopId: 's1', lat: -16.5, lng: -68.15, outcome: 'PROMISE_TO_PAY' as never });
    assert.equal(calls.visitCreate[0]!.collectorId, 'collector-1');
    assert.equal(calls.visitCreate[0]!.outcome, 'PROMISE_TO_PAY');
    assert.equal(calls.stopUpdate, 1);
    assert.ok(calls.events.includes('collector.location'));
    assert.ok(r.id);
  });

  it('dispara el chequeo del aviso mensual (L2) — que avisa, nunca frena', async () => {
    const { service, calls } = makeService();
    await service.createVisit({ routeStopId: 's1', lat: -16.5, lng: -68.15, outcome: 'PAID' as never });
    assert.deepEqual(calls.alerts, ['actionsPerMonth']);
  });
});

describe('FieldService.addEvidence', () => {
  const HELLO_B64 = Buffer.from('hello').toString('base64');
  const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  it('rechaza si el hash no coincide con el contenido (EVIDENCE_001)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.addEvidence('v1', { type: 'PHOTO' as never, fileUrl: 'u', fileHash: 'deadbeef', content: HELLO_B64 }), 'EVIDENCE_001');
  });

  it('sella la evidencia cuando el hash coincide', async () => {
    const { service, calls } = makeService();
    const r = await service.addEvidence('v1', { type: 'PHOTO' as never, fileUrl: 'u', fileHash: HELLO_SHA, content: HELLO_B64 });
    assert.equal(calls.evidence[0]!.fileHash, HELLO_SHA);
    assert.deepEqual(calls.audit, [{ entity: 'field_evidence', action: 'CREATE' }]);
    assert.equal(r.fileHash, HELLO_SHA);
    assert.deepEqual(calls.alerts, ['photosPerMonth'], 'la foto dispara su aviso mensual (L2)');
  });
});

/** Campos propios de cada variante del sheet de resultado (Rutas S5 · RT-6). */
describe('FieldService.createVisit · details por variante', () => {
  const base = { routeStopId: 's1', lat: -16.5, lng: -68.15 };

  it('NO_CONTACT sin canal no se registra: lo rechaza el server, no sólo la pantalla', async () => {
    const { service, calls } = makeService();
    await rejectsWithCode(service.createVisit({ ...base, outcome: 'NO_CONTACT' } as never), 'VISIT_DETAILS');
    assert.equal(calls.visitCreate.length, 0); // no escribe nada
  });

  it('NO_CONTACT guarda el canal y el aviso dejado', async () => {
    const { service, calls } = makeService();
    await service.createVisit({ ...base, outcome: 'NO_CONTACT', details: { channel: 'DOOR', noticeLeft: true } } as never);
    assert.deepEqual(calls.visitCreate[0]!.details, { channel: 'DOOR', noticeLeft: true });
  });

  it('descarta lo que el cliente mande de más', async () => {
    const { service, calls } = makeService();
    await service.createVisit({ ...base, outcome: 'NO_CONTACT', details: { channel: 'CALL', colado: 'x' } } as never);
    assert.deepEqual(calls.visitCreate[0]!.details, { channel: 'CALL' });
  });

  it('la categoría especial tiene que existir en el catálogo del tenant', async () => {
    const { service, calls } = makeService({ category: null });
    await rejectsWithCode(
      service.createVisit({ ...base, outcome: 'SPECIAL', details: { categoryCode: 'INVENTADA' } } as never),
      'VISIT_DETAILS',
    );
    assert.equal(calls.visitCreate.length, 0);
  });

  it('con una categoría válida sí registra', async () => {
    const { service, calls } = makeService();
    await service.createVisit({ ...base, outcome: 'SPECIAL', details: { categoryCode: 'DECEASED' } } as never);
    assert.deepEqual(calls.visitCreate[0]!.details, { categoryCode: 'DECEASED' });
  });

  it('el flag de GPS estimado se escribe fuera de `details`, que el validador descarta', async () => {
    const { service, calls } = makeService();
    await service.createVisit({ ...base, outcome: 'PAID', gpsFallback: true } as never);
    assert.deepEqual(calls.visitCreate[0]!.details, { gpsFallback: true });

    // Mandarlo dentro de `details` no alcanza: el validador lo descarta.
    const otro = makeService();
    await otro.service.createVisit({ ...base, outcome: 'PAID', details: { gpsFallback: true } } as never);
    assert.deepEqual(otro.calls.visitCreate[0]!.details, {});
  });

  // El flag que manda el cliente es una declaración, no una prueba: quien mande una coordenada
  // inventada y lo omita produciría una visita que una auditoría lee como GPS real. Lo que el
  // server SÍ puede comprobar es que la coordenada sea calcada al punto que él tiene de la parada.
  it('deriva el GPS estimado cuando la coordenada es calcada a la de la parada, aunque el body lo omita', async () => {
    const stop = { id: 's1', client: { locations: [{ locationType: 'HOME', latitude: -16.5, longitude: -68.15 }] } };
    const { service, calls } = makeService({ stop });
    await service.createVisit({ routeStopId: 's1', lat: -16.5, lng: -68.15, outcome: 'PAID' } as never);
    assert.deepEqual(calls.visitCreate[0]!.details, { gpsFallback: true });
  });

  it('una lectura real cerca de la parada NO se marca como estimada', async () => {
    const stop = { id: 's1', client: { locations: [{ locationType: 'HOME', latitude: -16.5, longitude: -68.15 }] } };
    const { service, calls } = makeService({ stop });
    await service.createVisit({ routeStopId: 's1', lat: -16.500012, lng: -68.150004, outcome: 'PAID' } as never);
    assert.deepEqual(calls.visitCreate[0]!.details, {});
  });
});

describe('FieldService.createVisit por crédito (F4/08)', () => {
  const GPS = { lat: -16.5, lng: -68.15, outcome: 'CONTACTED' as never };

  it('escribe credit_id, deja la gestión VISIT con el episodio abierto y actualiza last_action_at', async () => {
    const { service, calls } = makeService();
    await service.createVisit({ ...GPS, creditId: 'cr1' } as never);
    assert.equal(calls.visitCreate[0]!.creditId, 'cr1');
    assert.equal(calls.activityData[0]!.type, 'VISIT');
    assert.equal(calls.activityData[0]!.creditId, 'cr1');
    assert.equal(calls.activityData[0]!.clientId, 'cl1');
    assert.equal(calls.activityData[0]!.episodeId, 'ep1');
    assert.equal(calls.activityData[0]!.userId, 'collector-1');
    assert.ok(calls.creditUpdates[0]!.lastActionAt instanceof Date);
  });

  it('crédito fuera del alcance del cobrador: 404 y no se escribe nada', async () => {
    const { service, calls } = makeService({ visibleCredit: false });
    await rejectsWithCode(service.createVisit({ ...GPS, creditId: 'cr1' } as never), 'RESOURCE_NOT_FOUND');
    assert.equal(calls.visitCreate.length, 0);
    assert.equal(calls.activities, 0);
  });

  it('una visita por parada resuelve el crédito de la parada', async () => {
    const { service, calls } = makeService({ stop: { id: 's1', creditId: 'cr1' } });
    await service.createVisit({ ...GPS, routeStopId: 's1' } as never);
    assert.equal(calls.visitCreate[0]!.creditId, 'cr1');
    assert.equal(calls.activities, 1);
  });

  it('la parada de otro crédito que el mandado: VISIT_CREDIT', async () => {
    const { service } = makeService({ stop: { id: 's1', creditId: 'crX' } });
    await rejectsWithCode(service.createVisit({ ...GPS, routeStopId: 's1', creditId: 'cr1' } as never), 'VISIT_CREDIT');
  });

  it('el listado filtra por creditId', async () => {
    const { service, calls } = makeService();
    await service.list({ creditId: 'cr1' } as never);
    assert.equal(calls.listWhere!.creditId, 'cr1');
  });
});

describe('FieldService.createVisit idempotente por id (cola offline)', () => {
  const BASE = { creditId: 'cr1', lat: -16.5, lng: -68.15, outcome: 'CONTACTED' };
  const prior = { id: 'dup-id', creditId: 'cr1', routeStopId: null, collectorId: 'collector-1', outcome: 'CONTACTED', capturedAt: new Date('2026-08-01T10:00:00Z') };

  it('id ya existente (mismo crédito y cobrador): misma forma de respuesta, sin visita/actividad/ubicación/plan', async () => {
    const { service, calls } = makeService({ priorVisit: prior });
    const r = await service.createVisit({ ...BASE, id: 'dup-id' } as never);
    assert.deepEqual(r, { id: 'dup-id', outcome: 'CONTACTED', capturedAt: prior.capturedAt });
    assert.equal(calls.visitCreate.length, 0);
    assert.equal(calls.activities, 0);
    assert.equal(calls.stopUpdate, 0);
    assert.equal(calls.events.length, 0);
    assert.equal(calls.alerts.length, 0);
  });

  it('id de otro crédito: 409 VISIT_ID', async () => {
    const { service, calls } = makeService({ priorVisit: { ...prior, creditId: 'otro' } });
    await rejectsWithCode(service.createVisit({ ...BASE, id: 'dup-id' } as never), 'VISIT_ID');
    assert.equal(calls.visitCreate.length, 0);
  });

  it('id de otra parada de ruta: 409 VISIT_ID', async () => {
    const { service } = makeService({ priorVisit: { ...prior, creditId: null, routeStopId: 'sX' } });
    await rejectsWithCode(service.createVisit({ lat: -16.5, lng: -68.15, outcome: 'CONTACTED', routeStopId: 's1', id: 'dup-id' } as never), 'VISIT_ID');
  });

  it('id nuevo: crea la visita con ESE id', async () => {
    const { service, calls } = makeService();
    await service.createVisit({ ...BASE, id: 'new-id' } as never);
    assert.equal(calls.visitCreate[0]!.id, 'new-id');
    assert.equal(calls.activities, 1);
  });

  it('carrera: reintenta una vez y devuelve la ganadora sin duplicar efectos', async () => {
    const { service, calls } = makeService({ visitRace: true, priorVisit: prior });
    const r = await service.createVisit({ ...BASE, id: 'dup-id' } as never);
    assert.equal(r.id, 'dup-id');
    assert.equal(calls.visitCreate.length, 0);
    assert.equal(calls.activities, 0);
    assert.equal(calls.events.length, 0);
  });
});

describe('FieldService.createVisit · parada que nació de una visita agendada (F4/11)', () => {
  const GPS = { lat: -16.5, lng: -68.15, outcome: 'CONTACTED' as never, routeStopId: 's1' };

  it('cierra la gestión agendada con LA MISMA actividad: una sola ejecución', async () => {
    const { service, calls } = makeService({ stop: { id: 's1', creditId: 'cr1', agendaItemId: 'ai1' } });
    await service.createVisit(GPS as never);
    assert.equal(calls.activities, 1, 'una sola actividad en la bitácora');
    assert.equal(calls.agendaUpdates.length, 1);
    assert.deepEqual(calls.agendaUpdates[0]!.where, { id: 'ai1', status: 'SCHEDULED', deletedAt: null });
    assert.equal(calls.agendaUpdates[0]!.data.status, 'EXECUTED');
    assert.equal(calls.agendaUpdates[0]!.data.resultActivityId, 'act-1');
    assert.equal(calls.agendaUpdates[0]!.data.updatedBy, 'collector-1');
  });

  it('una parada sin visita agendada no toca la agenda', async () => {
    const { service, calls } = makeService({ stop: { id: 's1', creditId: 'cr1' } });
    await service.createVisit(GPS as never);
    assert.equal(calls.agendaUpdates.length, 0);
  });

  it('solo cierra una gestión que sigue pendiente: el filtro lo exige (cancelada o reagendada no se pisa)', async () => {
    const { service, calls } = makeService({ stop: { id: 's1', creditId: 'cr1', agendaItemId: 'ai1' } });
    await service.createVisit(GPS as never);
    assert.equal((calls.agendaUpdates[0]!.where as { status: string }).status, 'SCHEDULED');
  });
});

// ── F4/12 · quién registra, desde dónde, y cómo se corrige ────────────────────────────────────────────

describe('FieldService.createVisit · autoría y panel (F4/12)', () => {
  const body = { routeStopId: 's1', lat: -16.5, lng: -68.15, outcome: 'NO_CONTACT', details: { channel: 'DOOR' } } as never;
  const MANAGER = ['route:read', 'route:assign'];
  const stopOf = (collectorId: string, createdBy: string | null = null, status = 'IN_PROGRESS') => ({ route: { collectorId, createdBy, status } });

  it('el cobrador registra sobre SU parada y la visita queda marcada: registrada por él, desde el móvil', async () => {
    const { service, calls } = makeService();
    await service.createVisit(body);
    assert.equal(calls.visitCreate[0]!.collectorId, 'collector-1');
    assert.equal(calls.visitCreate[0]!.registeredBy, 'collector-1');
    assert.equal(calls.visitCreate[0]!.source, 'MOBILE');
    assert.ok(calls.audit.some((a) => a.entity === 'field_visit' && a.action === 'CREATE'), 'la creación de la visita se audita');
  });

  it('🔴 un cobrador NO registra sobre la parada de OTRO cobrador (404)', async () => {
    // Antes bastaba tener ROUTE_EXECUTE: cualquiera cerraba la jornada de otra persona.
    const { service, calls } = makeService({ stop: stopOf('otro-cobrador') });
    await rejectsWithCode(service.createVisit(body), 'RESOURCE_NOT_FOUND');
    assert.equal(calls.visitCreate.length, 0);
  });

  it('quien administra rutas registra A NOMBRE del cobrador: queda del cobrador, con quién la cargó, y su GPS es estimado', async () => {
    const { service, calls } = makeService({ permissions: MANAGER, stop: stopOf('cobrador-9', 'collector-1') });
    await service.createVisit({ ...body, source: 'WEB' } as never);
    const v = calls.visitCreate[0]!;
    assert.equal(v.collectorId, 'cobrador-9', 'la visita es del cobrador de la ruta');
    assert.equal(v.registeredBy, 'collector-1', 'y dice quién la cargó');
    assert.equal(v.source, 'WEB');
    assert.deepEqual(v.details, { channel: 'DOOR', gpsFallback: true }, 'la coordenada del panel no es una lectura del GPS del cobrador');
    assert.equal(calls.events.includes('collector.location'), false, 'no publica la ubicación del cobrador');
  });

  it('desde el panel no se registra sobre un crédito suelto: va sobre una parada (VISIT_STOP)', async () => {
    const { service } = makeService({ permissions: MANAGER });
    await rejectsWithCode(service.createVisit({ creditId: 'cr1', lat: -16.5, lng: -68.15, outcome: 'PAID' } as never), 'VISIT_STOP');
  });

  it('un auditor (solo leer) no registra visitas (403)', async () => {
    const { service } = makeService({ permissions: ['route:read'] });
    await rejectsWithCode(service.createVisit(body), 'AUTH_002');
  });

  it('una ruta cancelada no recibe visitas (VISIT_ROUTE_CANCELLED); una completada sí (se olvidó registrarla)', async () => {
    const cancelled = makeService({ stop: stopOf('collector-1', null, 'CANCELLED') });
    await rejectsWithCode(cancelled.service.createVisit(body), 'VISIT_ROUTE_CANCELLED');
    const completed = makeService({ stop: stopOf('collector-1', null, 'COMPLETED') });
    await completed.service.createVisit(body);
    assert.equal(completed.calls.visitCreate.length, 1);
  });

  it('🔴 una parada que ya tiene visita no se visita otra vez «a secas» (VISIT_STOP_DONE)', async () => {
    // Dos envíos con ids distintos dejaban dos visitas y pisaban la hora de la parada.
    const { service, calls } = makeService({ stop: { status: 'VISITED' }, existingVisits: 1 });
    await rejectsWithCode(service.createVisit(body), 'VISIT_STOP_DONE');
    assert.equal(calls.visitCreate.length, 0);
  });

  it('corregir = una visita NUEVA que apunta a la anterior: queda como nota, no cuenta otra gestión ni toca la parada', async () => {
    const { service, calls } = makeService({ stop: { status: 'VISITED', creditId: 'cr1' }, existingVisits: 1, priorVisit: null, visit: { id: 'v-vieja' } });
    await service.createVisit({ ...body, correctsVisitId: 'v-vieja' } as never);
    assert.equal(calls.visitCreate[0]!.correctsVisitId, 'v-vieja');
    assert.equal(calls.stopUpdate, 0, 'la parada ya estaba visitada');
    assert.equal(calls.activityData[0]!.type, 'NOTE', 'una corrección es una nota, no otra gestión');
    assert.equal(calls.agendaUpdates.length, 0, 'no cierra otra vez la agenda');
  });

  it('corregir una visita que no es de esa parada se rechaza (VISIT_CORRECTS)', async () => {
    const { service } = makeService({ stop: { status: 'VISITED' }, existingVisits: 1 });
    await rejectsWithCode(service.createVisit({ ...body, correctsVisitId: 'v-ajena' } as never), 'VISIT_CORRECTS');
  });

  it('una parada saltada se puede visitar después (se olvidó registrarla); si otra parada ya lleva la visita agendada, no se la pega', async () => {
    const own = makeService({ stop: { status: 'SKIPPED', agendaItemId: 'a1', creditId: 'cr1' } });
    await own.service.createVisit(body);
    assert.equal(own.calls.stopUpdateData[0]!.status, 'VISITED');
    assert.equal('agendaItemId' in own.calls.stopUpdateData[0]!, false, 'libre: vuelve a ser suya');
    assert.equal(own.calls.agendaUpdates.length, 1);

    const taken = makeService({ stop: { status: 'SKIPPED', agendaItemId: 'a1', creditId: 'cr1' }, otherStopsOnAgenda: 1 });
    await taken.service.createVisit(body);
    assert.equal(taken.calls.stopUpdateData[0]!.agendaItemId, null, 'no pelea el único parcial con la otra parada');
    assert.equal(taken.calls.agendaUpdates.length, 0, 'y no cierra una gestión que lleva otra parada');
  });
});

describe('FieldService.addEvidence · dueño y reintento (F4/12)', () => {
  const photo = { type: 'PHOTO' as never, fileUrl: '/api/uploads/a.jpg', fileHash: 'a'.repeat(64) };

  it('🔴 un cobrador no adjunta evidencia a la visita de otro (404)', async () => {
    const { service, calls } = makeService({ visit: { id: 'v1', latitude: 0, longitude: 0, collectorId: 'otro', registeredBy: 'otro' } });
    await rejectsWithCode(service.addEvidence('v1', photo), 'RESOURCE_NOT_FOUND');
    assert.equal(calls.evidence.length, 0);
  });

  it('quien administra rutas sí adjunta a la visita que cargó a nombre de un cobrador', async () => {
    const { service, calls } = makeService({ permissions: ['route:read', 'route:assign'], visit: { id: 'v1', latitude: 0, longitude: 0, collectorId: 'otro', registeredBy: 'collector-1' } });
    await service.addEvidence('v1', photo);
    assert.equal(calls.evidence.length, 1);
  });

  it('adjuntar dos veces la misma foto (reintento de la cola) devuelve la que ya estaba: sin duplicar ni auditar', async () => {
    const { service, calls } = makeService({ priorEvidence: { id: 'e0', type: 'PHOTO', fileHash: 'a'.repeat(64) } });
    const r = await service.addEvidence('v1', photo);
    assert.equal(r.id, 'e0');
    assert.equal(calls.evidence.length, 0);
    assert.equal(calls.audit.length, 0);
    assert.equal(calls.alerts.length, 0);
  });

  it('un auditor no adjunta evidencia (403)', async () => {
    const { service } = makeService({ permissions: ['route:read'] });
    await rejectsWithCode(service.addEvidence('v1', photo), 'AUTH_002');
  });
});

describe('FieldService.list · el día es el de la empresa (F4/12)', () => {
  it('🔴 una visita de las 21:00 en La Paz es de ese día, no del siguiente', async () => {
    const { service, calls } = makeService({ permissions: ['route:assign'], timezone: 'America/La_Paz' });
    await service.list({ date: '2026-08-12' } as never);
    const range = calls.listWhere!.capturedAt as { gte: Date; lt: Date };
    // El día civil 12 en UTC−4 empieza a las 04:00 UTC del 12 y termina a las 04:00 UTC del 13.
    assert.equal(range.gte.toISOString(), '2026-08-12T04:00:00.000Z');
    assert.equal(range.lt.toISOString(), '2026-08-13T04:00:00.000Z');
  });
});
