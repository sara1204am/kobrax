import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreditsService } from './credits.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { client?: unknown; credit?: unknown; config?: unknown; openCase?: unknown } = {}) {
  const calls = {
    creditCreate: [] as Record<string, unknown>[],
    creditUpdate: [] as Record<string, unknown>[],
    caseCreate: [] as Record<string, unknown>[],
    caseClose: [] as Record<string, unknown>[],
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
      findFirst: async () => opts.openCase ?? null,
      updateMany: async (args: { data: Record<string, unknown> }) => {
        calls.caseClose.push(args.data);
        return { count: opts.openCase ? 1 : 0 };
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

/**
 * Alta idempotente del préstamo, para que una encolada sin señal no le dé dos créditos al mismo
 * deudor si la cola reintenta. Mismo mecanismo que en clientes.
 */
describe('CreditsService.create — idempotencia del alta offline', () => {
  it('con un id ya existente devuelve ese préstamo y NO crea otro', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' }, credit: { id: 'ya-existe', currency: 'BOB', metadata: {} } });
    const res = await service.create({ ...(BASE as object), id: 'ya-existe' } as never);
    assert.equal(res.id, 'ya-existe');
    assert.equal(calls.creditCreate.length, 0, 'no debe insertar de nuevo');
  });

  it('el reintento no crea un segundo caso ni otro recordatorio en la agenda', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' }, credit: { id: 'ya-existe', currency: 'BOB', metadata: {} } });
    await service.create({ ...(BASE as object), id: 'ya-existe', openCase: true } as never);
    assert.equal(calls.caseCreate.length, 0);
    assert.equal(calls.agendaCreate.length, 0);
    assert.deepEqual(calls.audit, []);
  });

  it('con un id nuevo crea normalmente y lo usa', async () => {
    const { service, calls } = makeService({ client: { id: 'c1' } });
    await service.create({ ...(BASE as object), id: 'id-propuesto' } as never);
    assert.equal(calls.creditCreate[0]!.id, 'id-propuesto');
  });
});

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

  /** Ídem el importado, con otro dueño: la marcó una persona y el recálculo no le pisa el número. */
  it('mora marcada a mano: el recálculo la deriva de `moraSince`, no de la fecha de vencimiento', async () => {
    const credit = { id: 'cr1', installments: [], outstandingBalance: 900, daysPastDue: 0, metadata: { origin: 'manual', nextDueDate: '2026-07-12', moraSince: '2026-07-01' } };
    const { service, calls } = makeService({ credit });
    const r = await service.recalculateArrears('cr1', '2026-07-13T00:00:00Z');
    assert.equal(r.daysOverdue, 12); // desde la marca, no desde el vencimiento (que sería 1)
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 12);
  });
});

/**
 * «Este préstamo está en mora», dicho por una persona — para quien presta sin cronograma y sabe que
 * le deben sin mirar una fecha.
 */
describe('CreditsService.markArrears', () => {
  const activo = (over: Record<string, unknown> = {}) => ({
    id: 'cr1',
    status: 'ACTIVE',
    clientId: 'cl1',
    branchId: null,
    assignedManagerId: 'u-cobrador',
    outstandingBalance: 900,
    daysPastDue: 0,
    metadata: { origin: 'manual' },
    client: { riskSegment: null },
    installments: [],
    ...over,
  });

  it('guarda la FECHA desde la que corre, no los días', async () => {
    const { service, calls } = makeService({ credit: activo() });
    await service.markArrears('cr1', 15);
    const meta = calls.creditUpdate[0]!.metadata as { moraSince?: string };
    assert.ok(meta.moraSince, 'se guarda `moraSince`');
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 15);
  });

  /**
   * 🔴 **Abre el caso en el acto, sin esperar al trabajo diario.** Quien aprieta ese botón quiere ver
   * el crédito en Mora ahora; esperar al job sería decirle que su decisión vale dentro de seis horas.
   */
  it('abre el caso ahí mismo, heredando el responsable del préstamo', async () => {
    const { service, calls } = makeService({ credit: activo() });
    await service.markArrears('cr1');
    assert.equal(calls.caseCreate.length, 1);
    assert.equal(calls.caseCreate[0]!.assigneeId, 'u-cobrador');
  });

  it('con un caso ya abierto no crea otro', async () => {
    const { service, calls } = makeService({ credit: activo(), openCase: { id: 'k1' } });
    await service.markArrears('cr1');
    assert.equal(calls.caseCreate.length, 0);
  });

  /** Su mora la manda el archivo: la marca se guardaría y no haría nada. Mejor rebotar que mentir. */
  it('el importado no se puede marcar a mano', async () => {
    const { service } = makeService({ credit: activo({ metadata: { origin: 'import' } }) });
    await rejectsWithCode(service.markArrears('cr1'), 'CREDIT_LOCKED');
  });

  it('un crédito que ya no está activo tampoco', async () => {
    const { service } = makeService({ credit: activo({ status: 'PAID' }) });
    await rejectsWithCode(service.markArrears('cr1'), 'CREDIT_NOT_ACTIVE');
  });
});

/**
 * 🔴 **Poner al día es mover la fecha, no borrar el síntoma.** Un botón que sólo pusiera la mora en
 * cero dejaría la fecha vencida, y el trabajo diario volvería a abrir el caso esta misma noche.
 */
describe('CreditsService.clearArrears', () => {
  const enMora = (over: Record<string, unknown> = {}) => ({
    id: 'cr1',
    status: 'ACTIVE',
    clientId: 'cl1',
    outstandingBalance: 900,
    daysPastDue: 40,
    metadata: { origin: 'manual', frequency: 'MONTHLY', nextDueDate: '2026-07-01' },
    ...over,
  });

  it('«siguiente período» avanza la fecha y cierra el caso', async () => {
    const { service, calls } = makeService({ credit: enMora(), openCase: { id: 'k1' } });
    await service.clearArrears('cr1', { mode: 'next_period' });
    const meta = calls.creditUpdate[0]!.metadata as { nextDueDate?: string };
    assert.ok(meta.nextDueDate! > new Date().toISOString().slice(0, 10), 'la nueva fecha es futura');
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 0);
    assert.equal(calls.caseClose[0]!.closedReason, 'CURRENT');
  });

  it('«sin fecha» deja el préstamo abierto: sin vencimiento no hay mora que contar', async () => {
    const { service, calls } = makeService({ credit: enMora(), openCase: { id: 'k1' } });
    await service.clearArrears('cr1', { mode: 'none' });
    const meta = calls.creditUpdate[0]!.metadata as { nextDueDate?: string };
    assert.equal(meta.nextDueDate, undefined);
    assert.equal(calls.creditUpdate[0]!.daysPastDue, 0);
  });

  it('una fecha pasada se rechaza: dejaría el crédito en mora igual', async () => {
    const { service } = makeService({ credit: enMora() });
    await rejectsWithCode(service.clearArrears('cr1', { mode: 'date', date: '2020-01-01' }), 'ARREARS_DATE_PAST');
  });

  it('poner al día también saca la marca manual: quien la puso es quien la saca', async () => {
    const credit = enMora({ metadata: { origin: 'manual', frequency: 'MONTHLY', moraSince: '2026-01-01' } });
    const { service, calls } = makeService({ credit, openCase: { id: 'k1' } });
    await service.clearArrears('cr1', { mode: 'next_period' });
    const meta = calls.creditUpdate[0]!.metadata as { moraSince?: string };
    assert.equal(meta.moraSince, undefined);
  });
});
