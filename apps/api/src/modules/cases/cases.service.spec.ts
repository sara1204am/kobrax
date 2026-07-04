import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CasesService } from './cases.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: {
  credit?: unknown;
  openCase?: unknown;
  caseRow?: { status: string } | null;
  activityCount?: number;
  creditsInMora?: unknown[];
  openCreditIds?: string[];
} = {}) {
  const calls = {
    create: [] as Record<string, unknown>[],
    update: [] as Record<string, unknown>[],
    activity: [] as Record<string, unknown>[],
    audit: [] as { action: string }[],
    events: [] as string[],
  };
  const tx = {
    account: { findUnique: async () => ({ configuration: {} }) },
    credit: {
      findFirst: async () => opts.credit ?? null,
      findMany: async () => opts.creditsInMora ?? [],
    },
    collectionCase: {
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const w = args.where ?? {};
        if (w.creditId && w.status) return opts.openCase ?? null; // dup check
        if (w.id) return opts.caseRow ?? null;
        return null;
      },
      findMany: async () => (opts.openCreditIds ?? []).map((id) => ({ creditId: id })),
      create: async (args: { data: Record<string, unknown> }) => {
        calls.create.push(args.data);
        return { id: 'case1', ...args.data };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.update.push(args.data);
        return { id: args.where.id, ...(opts.caseRow as object), ...args.data };
      },
      count: async () => 0,
    },
    caseActivity: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.activity.push(args.data);
        return { id: 'act1', createdAt: new Date(), ...args.data };
      },
      count: async () => opts.activityCount ?? 0,
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'u1' };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e) };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const service = new CasesService(prisma as never, tenant as never, audit as never, events as never);
  return { service, calls };
}

const CREDIT = { id: 'cr1', clientId: 'cl1', branchId: null, outstandingBalance: 6000, daysPastDue: 35, client: { riskSegment: 'HIGH' } };

describe('CasesService.create', () => {
  it('crea el caso (PENDING) con prioridad calculada + SLA + audit + evento', async () => {
    const { service, calls } = makeService({ credit: CREDIT, openCase: null });
    const res = await service.create({ creditId: 'cr1' });
    assert.equal(res.status, 'PENDING');
    assert.equal(calls.create[0]!.priority, 'HIGH'); // 6 + 35 + 30 = 71
    assert.ok(calls.create[0]!.slaDueAt instanceof Date);
    assert.deepEqual(calls.audit.map((a) => a.action), ['CREATE']);
    assert.deepEqual(calls.events, ['case.updated']);
  });

  it('rechaza un segundo caso abierto para el crédito (CASE_DUP)', async () => {
    const { service } = makeService({ credit: CREDIT, openCase: { id: 'x' } });
    await rejectsWithCode(service.create({ creditId: 'cr1' }), 'CASE_DUP');
  });

  it('404 si el crédito no existe', async () => {
    const { service } = makeService({ credit: null });
    await rejectsWithCode(service.create({ creditId: 'cr1' }), 'RESOURCE_NOT_FOUND');
  });
});

describe('CasesService.transition (máquina de estados)', () => {
  it('permite una transición válida (PENDING → ACTIVE)', async () => {
    const { service, calls } = makeService({ caseRow: { status: 'PENDING' } });
    await service.transition('case1', { status: 'ACTIVE' as never });
    assert.equal(calls.update[0]!.status, 'ACTIVE');
    assert.deepEqual(calls.events, ['case.updated']);
  });

  it('rechaza una transición inválida (PENDING → PAID) con CASE_002', async () => {
    const { service } = makeService({ caseRow: { status: 'PENDING' } });
    await rejectsWithCode(service.transition('case1', { status: 'PAID' as never }), 'CASE_002');
  });
});

describe('CasesService.close', () => {
  it('no cierra sin gestión registrada (CASE_001)', async () => {
    const { service } = makeService({ caseRow: { status: 'PAID' }, activityCount: 0 });
    await rejectsWithCode(service.close('case1', 'pagado'), 'CASE_001');
  });

  it('cierra un caso PAID con gestión: status CLOSED + closedAt', async () => {
    const { service, calls } = makeService({ caseRow: { status: 'PAID' }, activityCount: 2 });
    await service.close('case1', 'pagado total');
    assert.equal(calls.update[0]!.status, 'CLOSED');
    assert.ok(calls.update[0]!.closedAt instanceof Date);
    assert.equal(calls.update[0]!.closedReason, 'pagado total');
  });
});

describe('CasesService.generate', () => {
  it('genera casos desde mora, idempotente (omite créditos con caso abierto)', async () => {
    const credits = [
      { id: 'c1', clientId: 'cl1', branchId: null, outstandingBalance: 1000, daysPastDue: 10, client: { riskSegment: 'LOW' } },
      { id: 'c2', clientId: 'cl2', branchId: null, outstandingBalance: 2000, daysPastDue: 20, client: { riskSegment: 'MEDIUM' } },
    ];
    const { service, calls } = makeService({ creditsInMora: credits, openCreditIds: ['c1'] });
    const r = await service.generate({});
    assert.equal(r.created, 1); // c1 ya tiene caso → omitido
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0]!.creditId, 'c2');
  });
});
