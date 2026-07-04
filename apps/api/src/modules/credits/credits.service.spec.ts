import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreditsService } from './credits.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { client?: unknown; credit?: unknown; config?: unknown } = {}) {
  const calls = {
    creditCreate: [] as Record<string, unknown>[],
    creditUpdate: [] as Record<string, unknown>[],
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
  const tenant = { accountId: 'acc-A' };
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
});
