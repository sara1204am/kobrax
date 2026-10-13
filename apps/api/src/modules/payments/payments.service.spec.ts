import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentsService } from './payments.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function activeCredit(balance = 200) {
  return {
    id: 'cr1',
    status: 'ACTIVE',
    branchId: null,
    outstandingBalance: balance,
    installments: [
      { id: 'i1', number: 1, amount: 100, paidAmount: 0, status: 'OVERDUE', dueDate: new Date('2026-01-01') },
      { id: 'i2', number: 2, amount: 100, paidAmount: 0, status: 'PENDING', dueDate: new Date('2026-07-01') },
    ],
  };
}

function makeService(opts: { credit?: unknown; idempotentExisting?: unknown; maxReceipt?: number; uniqueRace?: boolean; visit?: unknown } = {}) {
  let raced = false;
  const calls = {
    create: [] as Record<string, unknown>[],
    creditUpdate: [] as Record<string, unknown>[],
    audit: [] as string[],
    events: [] as string[],
  };
  const tx = {
    payment: {
      findFirst: async () => (opts.uniqueRace ? (raced ? opts.idempotentExisting : null) : opts.idempotentExisting ?? null),
      aggregate: async () => ({ _max: { receiptNumber: opts.maxReceipt ?? 0 } }),
      create: async (args: { data: Record<string, unknown> }) => {
        if (opts.uniqueRace && !raced) {
          raced = true;
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        calls.create.push(args.data);
        return { id: 'pay1', ...args.data };
      },
    },
    credit: {
      findFirst: async () => ('credit' in opts ? opts.credit : activeCredit()),
      update: async (args: { data: Record<string, unknown> }) => {
        calls.creditUpdate.push(args.data);
        return {};
      },
    },
    creditInstallment: { update: async () => ({}) },
    // F4/12: el cobro puede decir en qué visita se hizo.
    fieldVisit: { findFirst: async () => ('visit' in opts ? opts.visit : { creditId: 'cr1' }) },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'u1' };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const clock = { timezone: async () => 'America/La_Paz' };
  const service = new PaymentsService(prisma as never, tenant as never, audit as never, events as never, clock as never);
  return { service, calls };
}

const PAY = { creditId: 'cr1', method: 'CASH' as never };

/** Una operación PSF: saldo y mora del reporte, sin cuotas. */
function psfCredit(over: Record<string, unknown> = {}) {
  return {
    id: 'cr1',
    status: 'ACTIVE',
    branchId: 'b1',
    outstandingBalance: 1996.85,
    daysPastDue: 25,
    installments: [],
    metadata: { origin: 'import', importRunId: 'run1' },
    ...over,
  };
}

describe('PaymentsService.register — crédito PSF (D3)', () => {
  it('registra el Payment y no toca saldo, mora, estado ni cuotas', async () => {
    const { service, calls } = makeService({ credit: psfCredit() });
    const r = await service.register({ ...PAY, amount: 500 });
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0]!.amount, 500);
    assert.equal(calls.create[0]!.registeredBy, 'u1');
    assert.equal(calls.create[0]!.branchId, 'b1');
    assert.equal(calls.creditUpdate.length, 0); // saldo, mora y estado reportados intactos
    assert.deepEqual(calls.audit, ['CREATE']);
    assert.deepEqual(calls.events, ['payment.registered']);
    assert.equal(r.idempotentReplay, false);
  });

  it('un monto mayor al saldo reportado se acepta: el reporte puede ir atrasado', async () => {
    const { service, calls } = makeService({ credit: psfCredit({ outstandingBalance: 100 }) });
    await service.register({ ...PAY, amount: 500 });
    assert.equal(calls.create.length, 1);
    assert.equal(calls.creditUpdate.length, 0);
  });

  it('se acepta aunque el estado reportado no sea ACTIVE (un pago offline no se pierde)', async () => {
    const { service, calls } = makeService({ credit: psfCredit({ status: 'DEFAULTED' }) });
    await service.register({ ...PAY, amount: 50 });
    assert.equal(calls.create.length, 1);
  });

  // D1: el origen lo decide la columna, no un JSON que cualquier edición reescribe.
  it('manda la columna `origin`: IMPORT con metadata manual → rama PSF; MANUAL con metadata import → Kobrax', async () => {
    const psf = makeService({ credit: psfCredit({ origin: 'IMPORT', metadata: { origin: 'manual' } }) });
    await psf.service.register({ ...PAY, amount: 50 });
    assert.equal(psf.calls.creditUpdate.length, 0);

    const own = makeService({ credit: { ...activeCredit(), origin: 'MANUAL', metadata: { origin: 'import' } } });
    await own.service.register({ ...PAY, amount: 100 });
    assert.equal(own.calls.creditUpdate[0]!.outstandingBalance, 100);
  });

  it('guarda canal, nota y la fecha del cobro (pago offline sincronizado después)', async () => {
    const { service, calls } = makeService({ credit: psfCredit() });
    const cobrado = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await service.register({ ...PAY, amount: 500, channel: 'EXTERNAL_CONFIRMED' as never, notes: 'Pagó en ventanilla', paymentDate: cobrado });
    const data = calls.create[0]!;
    assert.equal(data.channel, 'EXTERNAL_CONFIRMED');
    assert.equal(data.notes, 'Pagó en ventanilla');
    assert.equal((data.paymentDate as Date).toISOString(), cobrado);
  });

  it('sin fecha no fija `paymentDate`: la pone la base (ahora)', async () => {
    const { service, calls } = makeService({ credit: psfCredit() });
    await service.register({ ...PAY, amount: 50 });
    assert.equal('paymentDate' in calls.create[0]!, false);
  });

  it('rechaza una fecha futura o de hace más de 30 días', async () => {
    const futura = new Date(Date.now() + 86_400_000).toISOString();
    const vieja = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await rejectsWithCode(makeService({ credit: psfCredit() }).service.register({ ...PAY, amount: 50, paymentDate: futura }), 'PAYMENT_001');
    await rejectsWithCode(makeService({ credit: psfCredit() }).service.register({ ...PAY, amount: 50, paymentDate: vieja }), 'PAYMENT_001');
  });

  it('igual rechaza monto ≤ 0 y crédito inexistente', async () => {
    await rejectsWithCode(makeService({ credit: psfCredit() }).service.register({ ...PAY, amount: 0 }), 'PAYMENT_001');
    await rejectsWithCode(makeService({ credit: null }).service.register({ ...PAY, amount: 50 }), 'RESOURCE_NOT_FOUND');
  });

  it('idempotencia: el reintento offline con la misma clave no duplica', async () => {
    const { service, calls } = makeService({ credit: psfCredit(), idempotentExisting: { id: 'old', creditId: 'cr1', amount: 500, method: 'CASH' } });
    const r = await service.register({ ...PAY, amount: 500 }, 'key-psf');
    assert.equal(r.idempotentReplay, true);
    assert.equal(calls.create.length, 0);
  });
});

describe('PaymentsService.register', () => {
  it('aplica el pago, reduce el saldo, registra y emite evento', async () => {
    const { service, calls } = makeService();
    const r = await service.register({ ...PAY, amount: 100 });
    assert.equal(calls.create[0]!.amount, 100);
    assert.equal(calls.create[0]!.receiptNumber, 1);
    assert.equal(calls.creditUpdate[0]!.outstandingBalance, 100); // 200 - 100
    assert.deepEqual(calls.audit, ['CREATE']);
    assert.deepEqual(calls.events, ['payment.registered']);
    assert.equal(r.idempotentReplay, false);
  });

  it('si el pago salda el crédito → status PAID y saldo 0', async () => {
    const { service, calls } = makeService();
    await service.register({ ...PAY, amount: 200 });
    assert.equal(calls.creditUpdate[0]!.outstandingBalance, 0);
    assert.equal(calls.creditUpdate[0]!.status, 'PAID');
  });

  it('saldada la deuda: el crédito PAID y el trigger de episodios terminan la mora', async () => {
    const { service, calls } = makeService();
    await service.register({ ...PAY, amount: 200 });
    assert.equal(calls.creditUpdate[0]!.status, 'PAID');
  });

  it('un pago parcial deja el crédito ACTIVE', async () => {
    const { service, calls } = makeService();
    await service.register({ ...PAY, amount: 100 });
    assert.equal(calls.creditUpdate[0]!.status, undefined);
  });

  /**
   * 🔴 D15: con el saldo = total por cobrar, la cuota que ya pasó el capital se cobra entera. Préstamo
   * de 1.000 en 5 cuotas de 300 (total 1.500): tras 3 cuotas quedan 600; la 4.ª cuota de 300 entra.
   * Con el saldo viejo (= capital) quedaban 100 y esta misma cuota se rechazaba.
   */
  it('D15: la cuota que cubre ganancia se cobra entera (saldo = total pendiente)', async () => {
    const credit = {
      id: 'cr1',
      status: 'ACTIVE',
      branchId: null,
      outstandingBalance: 600,
      installments: [],
      metadata: { origin: 'manual', balanceBasis: 'total', installmentAmount: 300, frequency: 'MONTHLY', nextDueDate: '2027-01-25' },
    };
    const { service, calls } = makeService({ credit });
    await service.register({ ...PAY, amount: 300 });
    assert.equal(calls.creditUpdate[0]!.outstandingBalance, 300);
    assert.equal(calls.creditUpdate[0]!.status, undefined); // todavía se debe la 5.ª
  });

  it('rechaza monto que excede el saldo (PAYMENT_001)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.register({ ...PAY, amount: 300 }), 'PAYMENT_001');
  });

  it('404 si el crédito no existe', async () => {
    const { service } = makeService({ credit: null });
    await rejectsWithCode(service.register({ ...PAY, amount: 50 }), 'RESOURCE_NOT_FOUND');
  });

  it('rechaza crédito no activo (CREDIT_NOT_ACTIVE)', async () => {
    const { service } = makeService({ credit: { ...activeCredit(), status: 'PAID' } });
    await rejectsWithCode(service.register({ ...PAY, amount: 50 }), 'CREDIT_NOT_ACTIVE');
  });

  it('idempotencia: mismo Idempotency-Key → no duplica (replay)', async () => {
    const { service, calls } = makeService({ idempotentExisting: { id: 'old', creditId: 'cr1', amount: 100, method: 'CASH' } });
    const r = await service.register({ ...PAY, amount: 100 }, 'key-123');
    assert.equal(r.idempotentReplay, true);
    assert.equal(calls.create.length, 0);
    assert.equal(calls.events.length, 0);
  });
});

/** Un service que sólo sabe listar: guarda con qué `orderBy` se llamó a Prisma. */
function makeLister(rows: unknown[] = []) {
  const calls: { orderBy?: Record<string, unknown>; where?: Record<string, unknown> } = {};
  const tx = {
    payment: {
      findMany: async (args: { orderBy: Record<string, unknown>; where: Record<string, unknown> }) => {
        calls.orderBy = args.orderBy;
        calls.where = args.where;
        return rows;
      },
      count: async () => 0,
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const clock = { timezone: async () => 'America/La_Paz' };
  const service = new PaymentsService(prisma as never, { accountId: 'acc-A' } as never, {} as never, {} as never, clock as never);
  return { service, calls };
}

describe('PaymentsService.list — fuente del crédito (D7)', () => {
  it('🔴 cliente y fuente comparten `where.credit`: el segundo no pisa al primero', async () => {
    const { service, calls } = makeLister();
    await service.list({ clientId: 'cl1', source: 'PSF' });
    assert.deepEqual(calls.where!.credit, { clientId: 'cl1', externalSource: 'PSF' });
    await service.list({ source: 'KOBRAX' });
    assert.deepEqual(calls.where!.credit, { externalSource: null });
  });

  it('day: el día civil de la empresa (La Paz = UTC−4), no el día UTC', async () => {
    const { service, calls } = makeLister();
    await service.list({ day: '2026-10-07' });
    const range = calls.where!.paymentDate as { gte: Date; lt: Date };
    // 00:00 del 7 en La Paz = 04:00 UTC; lo cobrado a las 21:00 locales (01:00 UTC del 8) sigue siendo del 7.
    assert.equal(range.gte.toISOString(), '2026-10-07T04:00:00.000Z');
    assert.equal(range.lt.toISOString(), '2026-10-08T04:00:00.000Z');
  });

  it('cada fila dice si el cobro fue sobre un crédito externo', async () => {
    const base = { id: 'p1', creditId: 'cr1', amount: 10, method: 'CASH', paymentDate: new Date(), channel: 'KOBRAX_COLLECTED', createdAt: new Date() };
    const { service } = makeLister([
      { ...base, credit: { externalSource: 'PSF' } },
      { ...base, id: 'p2', credit: { externalSource: null } },
    ]);
    const out = await service.list({});
    assert.equal(out.data![0]!.creditSource, 'PSF');
    assert.equal(out.data![1]!.creditSource, undefined);
  });
});

describe('PaymentsService.list — el orden', () => {
  it('sin pedir nada: lo último cobrado primero', async () => {
    // Un ledger se abre para ver qué entró recién, no para leerlo desde el principio de los tiempos.
    const { service, calls } = makeLister();
    await service.list({});
    assert.deepEqual(calls.orderBy, { paymentDate: 'desc' });
  });

  it('ordena por la columna pedida, en el sentido pedido', async () => {
    const { service, calls } = makeLister();
    await service.list({ sort: 'amount', dir: 'asc' });
    assert.deepEqual(calls.orderBy, { amount: 'asc' });
  });

  it('🔴 lo que falta va al final, no primero', async () => {
    /*
     * El comprobante es opcional y en Postgres los nulos van PRIMERO al ordenar descendente: pedir
     * «mayor número de comprobante» devolvía una página entera de pagos sin comprobante.
     */
    const { service, calls } = makeLister();
    await service.list({ sort: 'receiptNumber', dir: 'desc' });
    assert.deepEqual(calls.orderBy, { receiptNumber: { sort: 'desc', nulls: 'last' } });
  });

  it('sin sentido explícito, descendente: es el que sirve en plata y en fechas', async () => {
    const { service, calls } = makeLister();
    await service.list({ sort: 'method' });
    assert.deepEqual(calls.orderBy, { method: 'desc' });
  });
});

describe('PaymentsService.register — carrera por idempotency_key', () => {
  const existing = { id: 'pay-winner', creditId: 'cr1', amount: 100, method: 'CASH', idempotencyKey: 'k1', paymentDate: new Date('2026-08-01') };

  it('la violación de (account_id, idempotency_key) devuelve el pago existente como un reintento normal', async () => {
    const { service, calls } = makeService({ uniqueRace: true, idempotentExisting: existing });
    const r = await service.register({ ...PAY, amount: 100 }, 'k1');
    assert.equal(r.id, 'pay-winner');
    assert.equal(r.idempotentReplay, true);
    assert.equal(calls.create.length, 0);
    assert.deepEqual(calls.audit, []);
    assert.deepEqual(calls.events, []);
  });

  it('sin clave, la violación sigue siendo PAYMENT_DUP (no se reintenta)', async () => {
    const { service } = makeService({ uniqueRace: true });
    await rejectsWithCode(service.register({ ...PAY, amount: 100 }), 'PAYMENT_DUP');
  });
});

describe('PaymentsService.register · cobro dentro de una visita (F4/12)', () => {
  it('guarda la visita en la que se cobró, la audita y la devuelve', async () => {
    const { service, calls } = makeService();
    const r = await service.register({ ...PAY, amount: 100, visitId: 'v1' } as never);
    assert.equal(calls.create[0]!.visitId, 'v1');
    assert.equal((r as { visitId?: string }).visitId, 'v1');
    assert.ok(calls.audit.includes('CREATE'));
  });

  it('no todo cobro sale de una visita: sin visitId, el pago se registra igual', async () => {
    const { service, calls } = makeService();
    await service.register({ ...PAY, amount: 100 } as never);
    assert.equal(calls.create[0]!.visitId, undefined);
  });

  it('🔴 la visita tiene que existir y ser de ESE crédito (PAYMENT_001)', async () => {
    const otherCredit = makeService({ visit: { creditId: 'otro-credito' } });
    await rejectsWithCode(otherCredit.service.register({ ...PAY, amount: 100, visitId: 'v1' } as never), 'PAYMENT_001');
    const missing = makeService({ visit: null });
    await rejectsWithCode(missing.service.register({ ...PAY, amount: 100, visitId: 'v-fantasma' } as never), 'PAYMENT_001');
    assert.equal(otherCredit.calls.create.length, 0);
  });
});
