import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from './audit.service';
import { REDACTED } from './redact';
import type { RequestContext } from '../context/tenant-context.service';

/** Fake de PrismaService: withTenant ejecuta el callback con un tx que graba el create. */
function makeDeps(ctx: RequestContext | undefined) {
  const calls = { withTenant: [] as string[], created: [] as Record<string, unknown>[] };
  const tx = {
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.created.push(args.data);
        return args.data;
      },
    },
  };
  const prisma = {
    withTenant: async (accountId: string, fn: (t: typeof tx) => Promise<unknown>) => {
      calls.withTenant.push(accountId);
      return fn(tx);
    },
  };
  const tenantContext = { get: () => ctx };
  const service = new AuditService(prisma as never, tenantContext as never);
  return { service, calls };
}

const CTX: RequestContext = {
  accountId: 'acc-1',
  userId: 'user-1',
  ip: '1.2.3.4',
  userAgent: 'jest',
};

describe('AuditService.record', () => {
  it('no audita si no hay contexto de tenant', async () => {
    const { service, calls } = makeDeps(undefined);
    await service.record({ entity: 'client', entityId: 'c1', action: 'CREATE', after: { id: 'c1' } });
    assert.equal(calls.withTenant.length, 0);
    assert.equal(calls.created.length, 0);
  });

  it('graba en el tenant del contexto con who/entity/action', async () => {
    const { service, calls } = makeDeps(CTX);
    await service.record({ entity: 'client', entityId: 'c1', action: 'CREATE', after: { id: 'c1' } });
    assert.deepEqual(calls.withTenant, ['acc-1']);
    assert.equal(calls.created.length, 1);
    const row = calls.created[0]!;
    assert.equal(row.accountId, 'acc-1');
    assert.equal(row.userId, 'user-1');
    assert.equal(row.entity, 'client');
    assert.equal(row.entityId, 'c1');
    assert.equal(row.action, 'CREATE');
    assert.equal(row.ip, '1.2.3.4');
  });

  it('redacta PII en before/after antes de persistir', async () => {
    const { service, calls } = makeDeps(CTX);
    await service.record({
      entity: 'client',
      entityId: 'c1',
      action: 'UPDATE',
      before: { firstName: 'Ana', nationalId: 'CI-1' },
      after: { firstName: 'Ana María', nationalId: 'CI-1' },
    });
    const row = calls.created[0]! as { before: Record<string, unknown>; after: Record<string, unknown> };
    assert.equal(row.before.firstName, 'Ana');
    assert.equal(row.before.nationalId, REDACTED);
    assert.equal(row.after.firstName, 'Ana María');
    assert.equal(row.after.nationalId, REDACTED);
  });
});
