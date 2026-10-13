import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MoraService } from './mora.service';
import { PaymentsService } from '../payments/payments.service';
import { assignedToId, loadNames } from './mora-names';
import { serializeCreditActivity } from './credit-activity';
import { serializePromises } from './mora-promises';

/**
 * Nombres resueltos en el servidor: el cobrador no puede leer `GET /users` (`user:read`), así que la ficha trae los nombres
 * ya puestos. Sólo nombre y apellido, sólo de la cuenta de la petición, una consulta por petición.
 */

const CREDIT = '11111111-1111-4111-8111-111111111111';
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LUIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SIN_PERFIL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AJENO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Los miembros de la cuenta `acc`. `AJENO` es de otra cuenta; `SIN_PERFIL` tiene el perfil vacío (sólo correo). */
const MEMBERS: Record<string, { firstName: string; lastName: string } | null> = {
  [ANA]: { firstName: 'Ana', lastName: 'Pérez' },
  [LUIS]: { firstName: 'Luis', lastName: 'Rojas' },
  [SIN_PERFIL]: { firstName: '', lastName: '' },
};

function nameTable() {
  const lookups: { accountId: string; ids: string[] }[] = [];
  const userAccount = {
    findMany: async (a: { where: { accountId: string; userId: { in: string[] } } }) => {
      lookups.push({ accountId: a.where.accountId, ids: a.where.userId.in });
      if (a.where.accountId !== 'acc') return [];
      return a.where.userId.in
        .filter((id) => id in MEMBERS)
        .map((id) => ({ userId: id, user: { email: `${id}@kobrax.test`, profile: MEMBERS[id] } }));
    },
  };
  return { userAccount, lookups };
}

describe('loadNames', () => {
  it('sin ids no consulta; con ids repetidos consulta UNA vez con ids únicos', async () => {
    const { userAccount, lookups } = nameTable();
    assert.equal((await loadNames({ userAccount } as never, 'acc', [undefined, null])).size, 0);
    assert.equal(lookups.length, 0);
    const names = await loadNames({ userAccount } as never, 'acc', [ANA, LUIS, ANA, undefined]);
    assert.equal(lookups.length, 1);
    assert.deepEqual(lookups[0], { accountId: 'acc', ids: [ANA, LUIS] });
    assert.equal(names.get(ANA), 'Ana Pérez');
  });

  it('🔴 sólo de la cuenta de la petición, y nunca el correo: perfil vacío = sin nombre', async () => {
    const { userAccount } = nameTable();
    const names = await loadNames({ userAccount } as never, 'acc', [ANA, SIN_PERFIL, AJENO]);
    assert.deepEqual([...names.keys()], [ANA]);
    assert.equal([...names.values()].some((v) => v.includes('@')), false);
    assert.equal((await loadNames({ userAccount } as never, 'otra', [ANA])).size, 0, 'otra cuenta no resuelve a Ana');
  });
});

describe('assignedToId', () => {
  it('lee el id de la nota de una asignación, pelado o con el texto viejo «Asignado a <uuid>»', () => {
    assert.equal(assignedToId(ANA), ANA);
    assert.equal(assignedToId(`Asignado a ${ANA}`), ANA);
    assert.equal(assignedToId('no atendió'), undefined);
    assert.equal(assignedToId(null), undefined);
  });
});

describe('serializeCreditActivity — nombres', () => {
  const act = (type: string, notes: string | null, userId: string | null) => ({ id: 'a', type, result: null, notes, userId, createdAt: new Date(), episodeId: null }) as never;
  const names = new Map([[ANA, 'Ana Pérez'], [LUIS, 'Luis Rojas']]);

  it('autor para toda gestión; a quién se asignó sólo para ASSIGNMENT', () => {
    const call = serializeCreditActivity(act('CALL', `una nota con ${LUIS} adentro`, ANA), names);
    assert.equal(call.authorName, 'Ana Pérez');
    assert.equal(call.assignedToId, undefined, 'una llamada no es una asignación');
    assert.equal(call.assignedToName, undefined);
    const asg = serializeCreditActivity(act('ASSIGNMENT', LUIS, ANA), names);
    assert.equal(asg.assignedToId, LUIS);
    assert.equal(asg.assignedToName, 'Luis Rojas');
    assert.equal(serializeCreditActivity(act('ASSIGNMENT', `Asignado a ${LUIS}`, null), names).assignedToName, 'Luis Rojas');
  });

  it('sin mapa de nombres los campos quedan ausentes (aditivo)', () => {
    const r = serializeCreditActivity(act('ASSIGNMENT', LUIS, ANA));
    assert.equal(r.authorName, undefined);
    assert.equal(r.assignedToName, undefined);
    assert.equal(r.assignedToId, LUIS);
  });
});

describe('serializePromises — assigneeName', () => {
  it('trae el nombre de quien le da seguimiento', () => {
    const row = { id: 'p', status: 'SCHEDULED', scheduledDate: new Date('2026-10-10T00:00:00Z'), details: {}, observations: null, assigneeId: ANA, resultActivityId: null, createdAt: new Date('2026-10-01T00:00:00Z') };
    const [p] = serializePromises([row], new Map(), new Date('2026-10-04T00:00:00Z'), new Map([[ANA, 'Ana Pérez']]));
    assert.equal(p!.assigneeName, 'Ana Pérez');
    assert.equal(serializePromises([row], new Map(), new Date('2026-10-04T00:00:00Z'))[0]!.assigneeName, undefined);
  });
});

const creditRow = {
  id: CREDIT,
  code: 'C-1',
  clientId: 'cl1',
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
  assignedManagerId: ANA,
  branchId: null,
  branch: null,
  client: { firstName: 'Deudor', lastName: 'Uno', businessName: null },
  installments: [],
  arrearEpisodes: [{ priority: 'HIGH', priorityPinnedAt: null }],
  activities: [],
  payments: [],
};

function makeMora() {
  const { userAccount, lookups } = nameTable();
  const tx = {
    $queryRaw: async () => [{ id: CREDIT, client_id: 'cl1' }],
    credit: { findMany: async () => [creditRow] },
    account: { findUnique: async () => ({ configuration: {} }) },
    arrearCategory: { findMany: async () => [] },
    agendaItem: {
      findMany: async () => [
        { id: 'p1', status: 'SCHEDULED', scheduledDate: new Date(Date.now() + 5 * 86_400_000), details: { amount: 100 }, observations: null, assigneeId: LUIS, resultActivityId: null, createdAt: new Date() },
      ],
    },
    creditActivity: {
      findMany: async () => [
        { id: 'a1', type: 'ASSIGNMENT', result: null, notes: LUIS, userId: ANA, createdAt: new Date('2026-10-02T10:00:00Z'), episodeId: null },
        { id: 'a2', type: 'ASSIGNMENT', result: null, notes: `Asignado a ${AJENO}`, userId: ANA, createdAt: new Date('2026-10-01T10:00:00Z'), episodeId: null },
        { id: 'a3', type: 'CALL', result: 'NO_ANSWER', notes: null, userId: SIN_PERFIL, createdAt: new Date('2026-09-30T10:00:00Z'), episodeId: null },
      ],
    },
    creditAssignment: {
      findMany: async () => [{ id: 'as1', kind: 'APOYO', userId: LUIS, expiresAt: null }],
    },
    userAccount,
  };
  const service = new MoraService(
    { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never,
    { accountId: 'acc', userId: ANA, can: () => true } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, lookups };
}

describe('MoraService.findOne / promises — nombres sin user:read', () => {
  it('la ficha trae responsable, autores, a quién se asignó y asignaciones con nombre, en UNA consulta de nombres', async () => {
    const { service, lookups } = makeMora();
    const { data } = await service.findOne(CREDIT);
    assert.equal(lookups.length, 1, 'una sola consulta de nombres para toda la ficha');
    assert.deepEqual([...lookups[0]!.ids].sort(), [ANA, LUIS, SIN_PERFIL, AJENO].sort());
    assert.equal(data!.responsibleName, 'Ana Pérez');
    const [a1, a2, a3] = data!.activities;
    assert.equal(a1!.authorName, 'Ana Pérez');
    assert.equal(a1!.assignedToName, 'Luis Rojas');
    assert.equal(a2!.assignedToId, AJENO);
    assert.equal(a2!.assignedToName, undefined, 'un usuario de otra cuenta no se resuelve');
    assert.equal(a3!.authorName, undefined, 'sin nombre no se cae al correo');
    assert.deepEqual(data!.assignments.map((x) => [x.kind, x.userName]), [['PRINCIPAL', 'Ana Pérez'], ['APOYO', 'Luis Rojas']]);
    assert.equal(JSON.stringify(data).includes('@kobrax.test'), false, 'ni un correo en la respuesta');
  });

  it('GET promises: assigneeName', async () => {
    const { service, lookups } = makeMora();
    const { data } = await service.promises(CREDIT);
    assert.equal(data![0]!.assigneeName, 'Luis Rojas');
    assert.equal(lookups.length, 1);
  });
});

describe('PaymentsService — registeredByName', () => {
  it('list: nombre de quien registró cada pago, una consulta para la página; sin él, ausente', async () => {
    const { userAccount, lookups } = nameTable();
    const pay = (id: string, by: string | null) => ({ id, creditId: CREDIT, amount: 10, method: 'CASH', channel: 'KOBRAX_COLLECTED', registeredBy: by, paymentDate: new Date(), createdAt: new Date(), credit: { externalSource: null } });
    const tx = {
      payment: { findMany: async () => [pay('p1', ANA), pay('p2', LUIS), pay('p3', null), pay('p4', ANA)], count: async () => 4 },
      userAccount,
    };
    const service = new PaymentsService({ withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never, { accountId: 'acc' } as never, {} as never, {} as never, {} as never);
    const { data } = await service.list({ creditId: CREDIT });
    assert.deepEqual(data!.map((p) => p.registeredByName), ['Ana Pérez', 'Luis Rojas', undefined, 'Ana Pérez']);
    assert.equal(lookups.length, 1);
    assert.deepEqual(lookups[0]!.ids, [ANA, LUIS]);
  });
});
