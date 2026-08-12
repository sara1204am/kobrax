import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FieldService } from './field.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(
  opts: {
    visit?: unknown;
    stop?: unknown;
    case?: unknown;
    category?: unknown;
    permissions?: string[];
    listRows?: Record<string, unknown>[];
  } = {},
) {
  const calls = {
    visitCreate: [] as Record<string, unknown>[],
    stopUpdate: 0,
    evidence: [] as Record<string, unknown>[],
    events: [] as string[],
    audit: [] as { entity: string; action: string }[],
    listWhere: undefined as Record<string, unknown> | undefined,
    listOrderBy: undefined as Record<string, unknown>[] | undefined,
  };
  const tx = {
    collectionCase: { findFirst: async () => opts.case ?? { id: 'c1' }, update: async () => ({}) },
    routeStop: { findFirst: async () => opts.stop ?? { id: 's1' }, update: async () => { calls.stopUpdate += 1; return {}; } },
    caseActivity: { create: async () => ({}) },
    user: { update: async () => ({}) },
    fieldVisit: {
      findFirst: async () => opts.visit ?? { id: 'v1', latitude: -16.5, longitude: -68.15 },
      findMany: async (args: { where?: Record<string, unknown>; orderBy?: Record<string, unknown>[] }) => {
        calls.listWhere = args.where;
        calls.listOrderBy = args.orderBy;
        return opts.listRows ?? [];
      },
      count: async () => opts.listRows?.length ?? 0,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.visitCreate.push(args.data);
        return { id: 'v1', ...args.data };
      },
    },
    fieldEvidence: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.evidence.push(args.data);
        return { id: 'e1', ...args.data };
      },
    },
    // Catálogo del tenant: sólo lo consulta la gestión especial (S5). `null` = categoría inexistente.
    catalogItem: { findFirst: async () => ('category' in opts ? opts.category : { id: 'cat-1' }) },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const perms = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'collector-1', permissions: perms, can: (p: string) => perms.includes(p) };
  const audit = {
    record: async (e: { action: string; entity: string }) => void calls.audit.push({ entity: e.entity, action: e.action }),
  };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const service = new FieldService(prisma as never, tenant as never, audit as never, events as never);
  return { service, calls };
}

const ROW = {
  id: 'v1',
  caseId: 'c1',
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
  it('exige un objetivo (caso o parada)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.createVisit({ lat: -16.5, lng: -68.15, outcome: 'CONTACTED' as never }), 'VISIT_TARGET');
  });

  it('valida el GPS', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.createVisit({ caseId: 'c1', lat: 999, lng: 0, outcome: 'CONTACTED' as never } as never), 'VISIT_GPS');
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
