import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreditsService } from './credits.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { client?: unknown; credit?: unknown; config?: unknown } = {}) {
  const calls = {
    creditCreate: [] as Record<string, unknown>[],
    creditUpdate: [] as Record<string, unknown>[],
    caseCreate: [] as Record<string, unknown>[],
    agendaCreate: [] as Record<string, unknown>[],
    arrearCreate: [] as Record<string, unknown>[],
    arrearDeleteMany: 0,
    audit: [] as { action: string; entity: string }[],
  };
  const tx = {
    client: { findFirst: async () => opts.client ?? null },
    credit: {
      create: async (args: { data: Record<string, unknown>; include?: unknown }) => {
        calls.creditCreate.push(args.data);
        const installments = (args.data.installments as { create: unknown[] })?.create ?? [];
        return { id: 'cr1', createdAt: new Date(), updatedAt: new Date(), ...args.data, installments };
      },
      findFirst: async () => opts.credit ?? null,
      update: async (args: { data: Record<string, unknown> }) => {
        calls.creditUpdate.push(args.data);
        return { id: 'cr1', ...(opts.credit as object), ...args.data };
      },
    },
    creditInstallment: { updateMany: async () => ({ count: 1 }) },
    collectionCase: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.caseCreate.push(args.data);
        return { id: 'case1', ...args.data };
      },
    },
    agendaItem: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.agendaCreate.push(args.data);
        return { id: 'ag1', ...args.data };
      },
    },
    account: { findUnique: async () => ({ currencyCode: 'BOB', configuration: opts.config ?? {} }) },
    arrear: {
      deleteMany: async () => {
        calls.arrearDeleteMany += 1;
        return { count: 1 };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.arrearCreate.push(args.data);
        return args.data;
      },
    },
  };
  const prisma = {
    withTenant: async (_acc: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const tenant = { accountId: 'acc-A', userId: 'user-1' };
  const audit = { record: async (e: { action: string; entity: string }) => void calls.audit.push(e) };
  const service = new CreditsService(prisma as never, tenant as never, audit as never);
  return { service, calls };
}

const BASE = { clientId: '11111111-1111-1111-1111-111111111111', principalAmount: 1200, installmentsCount: 12 } as never;

describe('CreditsService.create', () => {
  it('genera el cronograma y deja outstandingBalance = principal', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    const res = await service.create(BASE);
    const data = calls.creditCreate[0]!;
    assert.equal(data.outstandingBalance, 1200);
    assert.equal((data.installments as { create: unknown[] }).create.length, 12);
    assert.equal(res.installmentsCount, 12);
    assert.equal(res.principalAmount, 1200);
    assert.deepEqual(calls.audit.map((a) => `${a.action} ${a.entity}`), ['CREATE credit']);
  });

  it('rechaza si el cliente no existe / es de otro tenant (RESOURCE_NOT_FOUND)', async () => {
    const { service } = makeService({ client: null });
    await rejectsWithCode(service.create(BASE), 'RESOURCE_NOT_FOUND');
  });

  it('rechaza moneda distinta a la del tenant (CREDIT_CURRENCY)', async () => {
    const { service } = makeService({ client: { id: 'c1' } });
    await rejectsWithCode(service.create({ ...(BASE as object), currency: 'USD' } as never), 'CREDIT_CURRENCY');
  });
});

/** El crédito de cobranza de la spec (§4): cuota congelada, sin cronograma. */
describe('CreditsService.create — crédito sin cronograma', () => {
  const MOVIL = { ...(BASE as object), installmentAmount: 300, frequency: 'WEEKLY', nextDueDate: '2026-07-20' } as never;

  it('con cuota congelada NO genera cronograma y guarda cuota/frecuencia/fecha en metadata', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    await service.create(MOVIL);
    const data = calls.creditCreate[0]!;
    assert.deepEqual((data.installments as { create: unknown[] }).create, []);
    assert.deepEqual(data.metadata, {
      frequency: 'WEEKLY',
      origin: 'manual',
      installmentAmount: 300,
      nextDueDate: '2026-07-20',
    });
  });

  it('préstamo abierto: sin número de cuotas se acepta y queda en 0 (§4.1)', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    await service.create({ clientId: BASE.clientId, principalAmount: 1000, installmentAmount: 250 } as never);
    assert.equal(calls.creditCreate[0]!.installmentsCount, 0);
  });

  it('"ya está en curso": respeta el saldo y la mora que trae el cobrador (§4.1)', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    await service.create({ ...(MOVIL as object), outstandingBalance: 800, daysPastDue: 45 } as never);
    const data = calls.creditCreate[0]!;
    assert.equal(data.outstandingBalance, 800); // no lo pisa con el capital
    assert.equal(data.daysPastDue, 45);
  });

  it('openCase abre el caso y el recordatorio en la agenda, en la misma transacción (§5.2)', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    await service.create({ ...(MOVIL as object), daysPastDue: 45, openCase: true } as never);
    const kase = calls.caseCreate[0]!;
    assert.equal(kase.creditId, 'cr1');
    assert.equal(kase.assigneeId, 'user-1'); // el cobrador que lo registró
    assert.equal(kase.priority, 'HIGH'); // 31–90 días
    // Próxima fecha de cobro en la agenda (§5.2): un REMINDER con la fecha del metadata, asignado al cobrador.
    const ag = calls.agendaCreate[0]!;
    assert.equal(ag.type, 'REMINDER');
    assert.equal(ag.assigneeId, 'user-1');
    assert.equal(ag.caseId, 'case1');
    assert.equal((ag.scheduledDate as Date).toISOString().slice(0, 10), '2026-07-20');
    assert.deepEqual(
      calls.audit.map((a) => `${a.action} ${a.entity}`),
      ['CREATE credit', 'CREATE collection_case', 'CREATE agenda_item'],
    );
  });

  it('sin openCase no se crea ni caso ni agenda', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    await service.create(MOVIL);
    assert.equal(calls.caseCreate.length, 0);
    assert.equal(calls.agendaCreate.length, 0);
  });

  it('openCase con cronograma (sin nextDueDate en metadata) crea el caso pero NO el recordatorio', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    await service.create({ ...(BASE as object), openCase: true } as never); // BASE = cuotas, sin cuota congelada
    assert.equal(calls.caseCreate.length, 1);
    assert.equal(calls.agendaCreate.length, 0); // sin próxima fecha en metadata → no hay recordatorio
  });
});

describe('CreditsService.update (editar desde la ficha §4)', () => {
  it('edita cuota/frecuencia/fecha y hace merge en metadata (crédito manual)', async () => {
    const credit = { id: 'cr1', metadata: { origin: 'manual', frequency: 'MONTHLY', installmentAmount: 300, nextDueDate: '2026-07-01' } };
    const { service, calls } = makeService({ credit });
    await service.update('cr1', { installmentAmount: 350, frequency: 'WEEKLY', nextDueDate: '2026-08-15', principalAmount: 1200 } as never);
    const data = calls.creditUpdate[0]!;
    assert.equal(data.principalAmount, 1200);
    assert.deepEqual(data.metadata, { origin: 'manual', frequency: 'WEEKLY', installmentAmount: 350, nextDueDate: '2026-08-15' });
    assert.deepEqual(calls.audit.map((a) => `${a.action} ${a.entity}`), ['UPDATE credit']);
  });

  it('crédito importado: rechaza editar datos financieros (CREDIT_LOCKED, §4.3)', async () => {
    const credit = { id: 'cr1', metadata: { origin: 'import', installmentAmount: 500 } };
    const { service } = makeService({ credit });
    await rejectsWithCode(service.update('cr1', { installmentAmount: 600 } as never), 'CREDIT_LOCKED');
  });

  it('editar solo status/código NO dispara el candado ni toca metadata', async () => {
    const credit = { id: 'cr1', metadata: { origin: 'import' } };
    const { service, calls } = makeService({ credit });
    await service.update('cr1', { code: 'ABC' } as never);
    assert.equal(calls.creditUpdate[0]!.metadata, undefined); // no reescribe metadata
  });
});

describe('CreditsService.recalculateArrears', () => {
  it('calcula mora, actualiza daysPastDue y reemplaza el snapshot (idempotente)', async () => {
    const credit = {
      id: 'cr1',
      installments: [
        { id: 'i1', dueDate: new Date('2026-01-01T00:00:00Z'), amount: 100, paidAmount: 0, status: 'PENDING' },
      ],
    };
    const { service, calls } = makeService({ credit, config: { arrears: { dailyMoratoriumRate: 0.001, penaltyRate: 0.02, graceDays: 0 } } });
    const r = await service.recalculateArrears('cr1', '2026-01-11T00:00:00Z');

    assert.equal(r.daysOverdue, 10);
    assert.equal(r.overdueAmount, 100);
    assert.equal(r.interest, 1);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 10);
    assert.equal(calls.arrearDeleteMany, 1); // snapshot reemplazado
    assert.equal(calls.arrearCreate[0]!.daysOverdue, 10);
    assert.deepEqual(calls.audit.map((a) => a.action), ['ARREARS_RECALC']);
  });

  it('404 si el crédito no existe', async () => {
    const { service } = makeService({ credit: null });
    await rejectsWithCode(service.recalculateArrears('cr1'), 'RESOURCE_NOT_FOUND');
  });

  /**
   * La mora ya NO se pisa con 0 cuando el crédito no tiene cuotas. `computeArrears` sobre un array
   * vacío devuelve 0, y eso se escribía a ciegas: al crédito del móvil le borraba la mora real, y al
   * importado le borraba la que trajo el archivo.
   */
  it('sin cronograma: la mora sale de nextDueDate, no de las cuotas', async () => {
    const credit = { id: 'cr1', installments: [], outstandingBalance: 900, daysPastDue: 0, metadata: { origin: 'manual', frequency: 'MONTHLY', nextDueDate: '2026-07-01' } };
    const { service, calls } = makeService({ credit });
    const r = await service.recalculateArrears('cr1', '2026-07-13T00:00:00Z');
    assert.equal(r.daysOverdue, 12);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 12);
  });

  it('sin cronograma y saldado: mora 0 aunque la fecha esté vencida', async () => {
    const credit = { id: 'cr1', installments: [], outstandingBalance: 0, daysPastDue: 5, metadata: { origin: 'manual', nextDueDate: '2026-07-01' } };
    const { service } = makeService({ credit });
    const r = await service.recalculateArrears('cr1', '2026-07-13T00:00:00Z');
    assert.equal(r.daysOverdue, 0);
  });

  it('cartera importada: el recálculo es NO-OP — manda el archivo (§6)', async () => {
    const credit = { id: 'cr1', installments: [], outstandingBalance: 900, daysPastDue: 37, metadata: { origin: 'import', nextDueDate: '2026-07-01' } };
    const { service, calls } = makeService({ credit });
    const r = await service.recalculateArrears('cr1', '2026-07-13T00:00:00Z');
    assert.equal(r.daysOverdue, 37); // conserva el valor del archivo
    assert.equal(calls.creditUpdate.length, 0); // ni siquiera toca la DB
  });
});
