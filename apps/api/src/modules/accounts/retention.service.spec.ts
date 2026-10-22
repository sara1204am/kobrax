import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS } from '@kobrax/shared';
import { RetentionService } from './retention.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { planCode?: string; override?: unknown; account?: null; total?: number; older?: number } = {}) {
  const calls = { counts: [] as (Record<string, unknown> | undefined)[] };
  const tx = {
    account: {
      findFirst: async () =>
        opts.account === null ? null : { planCode: opts.planCode ?? 'PROFESSIONAL', limitsOverride: opts.override ?? null },
    },
    fieldEvidence: {
      count: async (args?: { where?: Record<string, unknown> }) => {
        calls.counts.push(args?.where);
        return args?.where ? (opts.older ?? 0) : (opts.total ?? 0);
      },
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { service: new RetentionService(prisma as never, { accountId: 'acc-A' } as never), calls };
}

const NOW = new Date('2026-10-21T12:00:00Z');

describe('RetentionService.cutoff', () => {
  it('resta meses de calendario, no 30 días por mes', () => {
    assert.equal(RetentionService.cutoff(24, NOW).toISOString(), '2024-10-21T12:00:00.000Z');
    assert.equal(RetentionService.cutoff(6, NOW).toISOString(), '2026-04-21T12:00:00.000Z');
  });
});

describe('RetentionService.report (modo simulación)', () => {
  it('cuenta cuántas fotos pasaron el plazo del plan, sobre el total', async () => {
    const { service, calls } = makeService({ planCode: 'PROFESSIONAL', total: 900, older: 120 });
    const r = await service.report(NOW);
    assert.deepEqual(r, { retentionMonths: PLANS.PROFESSIONAL.limits.photoRetentionMonths, total: 900, older: 120 });
    const where = calls.counts.find((w) => w)!;
    assert.deepEqual((where.createdAt as { lt: Date }).lt.toISOString(), '2024-10-21T12:00:00.000Z');
  });

  it('un plan con otro plazo usa el suyo', async () => {
    const { service } = makeService({ planCode: 'FREE', total: 10, older: 4 });
    assert.equal((await service.report(NOW)).retentionMonths, PLANS.FREE.limits.photoRetentionMonths);
  });

  it('la excepción negociada de la cuenta le gana al plan', async () => {
    const { service } = makeService({ planCode: 'FREE', override: { photoRetentionMonths: 60 }, total: 10, older: 0 });
    assert.equal((await service.report(NOW)).retentionMonths, 60);
  });

  it('sin límite de conservación no hay «viejas» y ni siquiera consulta cuáles', async () => {
    const { service, calls } = makeService({ override: { photoRetentionMonths: null }, total: 50, older: 99 });
    const r = await service.report(NOW);
    assert.deepEqual(r, { retentionMonths: null, total: 50, older: 0 });
    assert.equal(calls.counts.filter((w) => w).length, 0);
  });

  it('404 si la cuenta no existe', async () => {
    const { service } = makeService({ account: null });
    await rejectsWithCode(service.report(NOW), 'ACCOUNT_NOT_FOUND');
  });
});
