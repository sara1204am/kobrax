import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FieldService } from './field.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { visit?: unknown; stop?: unknown; case?: unknown; category?: unknown } = {}) {
  const calls = { visitCreate: [] as Record<string, unknown>[], stopUpdate: 0, evidence: [] as Record<string, unknown>[], events: [] as string[], audit: [] as string[] };
  const tx = {
    collectionCase: { findFirst: async () => opts.case ?? { id: 'c1' }, update: async () => ({}) },
    routeStop: { findFirst: async () => opts.stop ?? { id: 's1' }, update: async () => { calls.stopUpdate += 1; return {}; } },
    caseActivity: { create: async () => ({}) },
    user: { update: async () => ({}) },
    fieldVisit: {
      findFirst: async () => opts.visit ?? { id: 'v1', latitude: -16.5, longitude: -68.15 },
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
  const tenant = { accountId: 'acc-A', userId: 'collector-1' };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const service = new FieldService(prisma as never, tenant as never, audit as never, events as never);
  return { service, calls };
}

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
    assert.deepEqual(calls.audit, ['CREATE']);
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
