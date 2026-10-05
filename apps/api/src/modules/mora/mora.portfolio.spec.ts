import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MoraService } from './mora.service';

/**
 * F4/08 fase 5 · `GET /mora` como fuente de la cartera y de la planificación de rutas: zona, ubicaciones y
 * documento enmascarado del deudor, cargados en UNA consulta para toda la página.
 */

const row = (id: string, clientId: string) => ({
  id,
  code: `C-${id}`,
  clientId,
  currency: 'BOB',
  outstandingBalance: '500',
  principalAmount: '1000',
  daysPastDue: 12,
  metadata: {},
  origin: null,
  externalSource: null,
  syncStatus: null,
  reportedAsOf: null,
  absentSince: null,
  writtenOffAt: null,
  lastActionAt: null,
  assignedManagerId: 'u1',
  branchId: null,
  branch: null,
  client: { firstName: 'Ana', lastName: clientId, businessName: null },
  installments: [],
  arrearEpisodes: [{ priority: 'HIGH', priorityPinnedAt: null }],
  activities: [],
  payments: [],
});

const LOC = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  locationType: 'HOME',
  zone: null,
  address: null,
  latitude: null,
  longitude: null,
  relationId: null,
  relation: null,
  ...over,
});

function make() {
  const calls = { clientFind: [] as { where: { id: { in: string[] } } }[], audit: [] as Record<string, unknown>[], nameFinds: [] as { userId: { in: string[] } }[] };
  const tx = {
    $queryRaw: async () => [
      { id: 'cr1', total: 3n },
      { id: 'cr2', total: 3n },
      { id: 'cr3', total: 3n },
    ],
    credit: { findMany: async () => [row('cr1', 'cl1'), row('cr2', 'cl1'), row('cr3', 'cl2')] },
    account: { findUnique: async () => ({ configuration: {} }) },
    arrearCategory: { findMany: async () => [] },
    userAccount: {
      findMany: async (a: { where: { userId: { in: string[] } } }) => {
        calls.nameFinds.push(a.where);
        return [{ userId: 'u1', user: { profile: { firstName: 'Ana', lastName: 'Pérez' } } }];
      },
    },
    agendaItem: { findMany: async () => [] },
    client: {
      findMany: async (a: { where: { id: { in: string[] } } }) => {
        calls.clientFind.push(a);
        return [
          {
            id: 'cl1',
            nationalId: 'enc:1234567',
            locations: [
              // La primera cargada es del trabajo: la zona sale de la primera HOME propia.
              LOC('l0', { locationType: 'WORK', zone: 'Mercado', latitude: '-17.1', longitude: '-66.1' }),
              LOC('l1', { zone: 'Centro', address: 'enc:Calle 1', latitude: '-17.39', longitude: '-66.15' }),
              LOC('l2', { zone: 'Norte', relationId: 'rel1', relation: { relatedName: 'Luis', relationshipType: 'GUARANTOR' }, latitude: '-17.4', longitude: '-66.2' }),
              LOC('l3', { zone: 'Sur' }), // sin punto: no se dibuja
            ],
          },
          { id: 'cl2', nationalId: null, locations: [LOC('l4', { locationType: 'WORK', zone: 'Sur', latitude: '-17.5', longitude: '-66.3' })] },
        ];
      },
    },
  };
  const crypto = {
    decrypt: (v: string) => {
      if (!v.startsWith('enc:')) throw new Error('legado en claro');
      return v.slice(4);
    },
  };
  const service = new MoraService(
    { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never,
    { accountId: 'acc', userId: 'u1', can: () => true } as never,
    { record: async (e: Record<string, unknown>) => void calls.audit.push(e) } as never,
    {} as never,
    {} as never,
    crypto as never,
  );
  return { service, calls };
}

describe('GET /mora — zona, ubicaciones y documento de la cartera', () => {
  it('responsibleName: el nombre del responsable en cada fila, con UNA consulta de nombres para toda la página', async () => {
    const { service, calls } = make();
    const { data } = await service.list({ todos: 'true' } as never);
    assert.deepEqual(data!.map((d) => d.responsibleName), ['Ana Pérez', 'Ana Pérez', 'Ana Pérez']);
    assert.equal(calls.nameFinds.length, 1);
    assert.deepEqual(calls.nameFinds[0]!.userId.in, ['u1'], 'ids únicos');
  });

  it('carga los clientes de TODA la página en UNA sola consulta (sin N+1) y sin repetir ids', async () => {
    const { service, calls } = make();
    await service.list({ todos: 'true' } as never);
    assert.equal(calls.clientFind.length, 1);
    assert.deepEqual([...calls.clientFind[0]!.where.id.in].sort(), ['cl1', 'cl2']);
  });

  it('zona = la de la primera HOME propia (no la de un garante ni la del trabajo); sin HOME, la primera propia', async () => {
    const { service } = make();
    const { data } = await service.list({ todos: 'true' } as never);
    assert.equal(data![0]!.zone, 'Centro');
    assert.equal(data![2]!.zone, 'Sur');
  });

  it('locations: sólo las dibujables (con punto), con la forma de PortfolioLocation y las del garante incluidas', async () => {
    const { service } = make();
    const { data } = await service.list({ todos: 'true' } as never);
    const locs = data![0]!.locations!;
    assert.deepEqual(locs.map((l) => l.id), ['l0', 'l1', 'l2'], 'l3 no tiene punto');
    assert.deepEqual(locs[1], { id: 'l1', locationType: 'HOME', latitude: -17.39, longitude: -66.15, address: 'Calle 1', ownerName: undefined, ownerRelation: undefined });
    assert.equal(locs[2]!.ownerName, 'Luis');
    assert.equal(locs[2]!.ownerRelation, 'GUARANTOR');
    assert.deepEqual(data![1]!.locations, locs, 'dos créditos del mismo cliente comparten las ubicaciones');
  });

  it('documento siempre enmascarado; sin documento, ausente', async () => {
    const { service } = make();
    const { data } = await service.list({ todos: 'true' } as never);
    assert.ok(data![0]!.documentMasked);
    assert.doesNotMatch(data![0]!.documentMasked!, /1234567/);
    assert.equal(data![2]!.documentMasked, undefined);
  });

  it('audita el revelado del domicilio UNA vez por consulta', async () => {
    const { service, calls } = make();
    await service.list({ todos: 'true' } as never);
    assert.equal(calls.audit.length, 1);
    assert.deepEqual({ entity: calls.audit[0]!.entity, action: calls.audit[0]!.action }, { entity: 'credit_portfolio', action: 'PII_REVEAL' });
  });

  it('el export por lotes no carga ubicaciones ni audita', async () => {
    const { service, calls } = make();
    const first = (await service.batches({ todos: 'true' } as never, 1000).next()).value!;
    assert.equal(calls.clientFind.length, 0);
    assert.equal(calls.audit.length, 0);
    assert.equal(first[0]!.locations, undefined);
  });

  it('trae los campos que el móvil leía de CaseListItem: creditId, priority, situation, frequency, origin, locked', async () => {
    const { service } = make();
    const { data } = await service.list({ todos: 'true' } as never);
    assert.ok('locked' in data![0]! && 'origin' in data![0]! && 'frequency' in data![0]!);
    assert.equal(data![0]!.creditId, 'cr1');
    assert.equal(data![0]!.priority, 'HIGH');
    assert.equal(data![0]!.situation, 'IN_ARREARS');
  });
});
