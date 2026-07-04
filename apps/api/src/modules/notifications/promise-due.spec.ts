import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PromiseDueService } from './promise-due.service';

const NOW = new Date('2026-06-18T12:00:00Z');
const soon = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

interface Opts {
  installments?: { creditId: string; number: number; dueDate: Date }[];
  caseByCredit?: Record<string, { id: string; assigneeId: string | null } | null>;
  dup?: boolean;
  accountIds?: string[];
  throwEnumeration?: boolean;
}

function makeService(opts: Opts = {}) {
  const calls = { notified: [] as { userId: string; data: Record<string, unknown> }[] };
  const tx = {
    creditInstallment: { findMany: async () => opts.installments ?? [] },
    collectionCase: {
      findFirst: async (args: { where: { creditId: string } }) =>
        opts.caseByCredit ? (opts.caseByCredit[args.where.creditId] ?? null) : { id: `case-${args.where.creditId}`, assigneeId: 'col1' },
    },
    notification: { findFirst: async () => (opts.dup ? { id: 'existing' } : null) },
  };
  const prisma = {
    withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    $queryRaw: async () => {
      if (opts.throwEnumeration) throw new Error('function does not exist');
      return (opts.accountIds ?? ['acc-A']).map((account_id) => ({ account_id }));
    },
  };
  const notifications = {
    notifyUser: async (_accountId: string, userId: string, data: Record<string, unknown>) =>
      void calls.notified.push({ userId, data }),
  };
  const service = new PromiseDueService(prisma as never, notifications as never);
  return { service, calls };
}

describe('PromiseDueService.scanAccount', () => {
  it('avisa al cobrador asignado de la cuota próxima a vencer', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
    });
    const n = await service.scanAccount('acc-A', NOW);
    assert.equal(n, 1);
    assert.equal(calls.notified[0]!.userId, 'col1');
    assert.equal(calls.notified[0]!.data.type, 'PROMISE_DUE');
    assert.equal(calls.notified[0]!.data.caseId, 'case-cr1');
  });

  it('toma solo el primer vencimiento por crédito', async () => {
    const { service, calls } = makeService({
      installments: [
        { creditId: 'cr1', number: 3, dueDate: soon(1) },
        { creditId: 'cr1', number: 4, dueDate: soon(2) },
      ],
    });
    const n = await service.scanAccount('acc-A', NOW);
    assert.equal(n, 1);
    assert.equal(calls.notified[0]!.data.body, `La cuota 3 vence el ${soon(1).toISOString().slice(0, 10)}.`);
  });

  it('idempotente: no reavisa si ya hay un PROMISE_DUE reciente', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
      dup: true,
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(calls.notified.length, 0);
  });

  it('omite créditos cuyo caso no tiene cobrador asignado', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 3, dueDate: soon(2) }],
      caseByCredit: { cr1: null },
    });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
    assert.equal(calls.notified.length, 0);
  });

  it('sin cuotas próximas → no hace nada', async () => {
    const { service } = makeService({ installments: [] });
    assert.equal(await service.scanAccount('acc-A', NOW), 0);
  });
});

describe('PromiseDueService.run', () => {
  it('barre los tenants enumerados', async () => {
    const { service, calls } = makeService({
      installments: [{ creditId: 'cr1', number: 1, dueDate: soon(1) }],
      accountIds: ['acc-A', 'acc-B'],
    });
    const total = await service.run(NOW);
    assert.equal(total, 2); // un aviso por tenant
    assert.equal(calls.notified.length, 2);
  });

  it('resiliente: si la función de enumeración no existe, omite el job', async () => {
    const { service } = makeService({ throwEnumeration: true });
    assert.equal(await service.run(NOW), 0);
  });
});
