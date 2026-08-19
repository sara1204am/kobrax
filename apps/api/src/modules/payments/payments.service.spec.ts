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

function makeService(opts: { credit?: unknown; idempotentExisting?: unknown; maxReceipt?: number } = {}) {
  const calls = {
    create: [] as Record<string, unknown>[],
    creditUpdate: [] as Record<string, unknown>[],
    caseClose: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    audit: [] as string[],
    events: [] as string[],
  };
  const tx = {
    collectionCase: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.caseClose.push(args);
        return { count: 1 };
      },
    },
    payment: {
      findFirst: async () => opts.idempotentExisting ?? null,
      aggregate: async () => ({ _max: { receiptNumber: opts.maxReceipt ?? 0 } }),
      create: async (args: { data: Record<string, unknown> }) => {
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
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'u1' };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const service = new PaymentsService(prisma as never, tenant as never, audit as never, events as never);
  return { service, calls };
}

const PAY = { creditId: 'cr1', method: 'CASH' as never };

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

  /**
   * 🔴 Antes el pago dejaba el crédito en `PAID` y **no tocaba el caso**: quedaba abierto, seguía
   * entrando a las rutas, y el cobrador volvía a visitar a quien ya había pagado. Va en la misma
   * transacción que el pago y no en el trabajo diario: entre cobrar y que corra el job hay horas, y
   * en esas horas el caso sigue en la ruta de alguien.
   */
  it('saldada la deuda, cierra el caso en la misma transacción', async () => {
    const { service, calls } = makeService();
    await service.register({ ...PAY, amount: 200 });
    assert.equal(calls.caseClose.length, 1);
    assert.equal(calls.caseClose[0]!.data.status, 'CLOSED');
    assert.equal(calls.caseClose[0]!.data.closedReason, 'PAID');
    assert.equal(calls.caseClose[0]!.where.creditId, 'cr1');
  });

  it('un pago parcial NO cierra el caso: todavía se debe', async () => {
    const { service, calls } = makeService();
    await service.register({ ...PAY, amount: 100 });
    assert.equal(calls.caseClose.length, 0);
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
function makeLister() {
  const calls: { orderBy?: Record<string, unknown> } = {};
  const tx = {
    payment: {
      findMany: async (args: { orderBy: Record<string, unknown> }) => {
        calls.orderBy = args.orderBy;
        return [];
      },
      count: async () => 0,
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const service = new PaymentsService(prisma as never, { accountId: 'acc-A' } as never, {} as never, {} as never);
  return { service, calls };
}

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
