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
  permissions: [],
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

describe('AuditService.recordInTx (F14 · F7, D-5)', () => {
  it('escribe en la MISMA transacción que recibe, con who/entity/action, sin abrir otra', async () => {
    const { service, calls } = makeDeps(CTX);
    const written: Record<string, unknown>[] = [];
    const tx = { auditLog: { create: async (a: { data: Record<string, unknown> }) => (written.push(a.data), a.data) } };
    await service.recordInTx(tx as never, { entity: 'account_role', entityId: 'r1', action: 'ROLE_PERMISSIONS_UPDATED', after: { added: ['x'] } });
    assert.equal(calls.withTenant.length, 0, 'no abre una transacción propia');
    assert.equal(written.length, 1);
    assert.equal(written[0]!.accountId, 'acc-1');
    assert.equal(written[0]!.userId, 'user-1');
    assert.equal(written[0]!.entity, 'account_role');
  });

  it('🔴 si la escritura falla, el error SE PROPAGA (el cambio de negocio no queda sin su rastro)', async () => {
    const { service } = makeDeps(CTX);
    const tx = { auditLog: { create: async () => { throw new Error('disco lleno'); } } };
    await assert.rejects(() => service.recordInTx(tx as never, { entity: 'account_role', entityId: 'r1', action: 'X' }), /disco lleno/);
  });

  it('🔴 sin contexto de tenant lanza: un cambio sensible sin autor no se hace', async () => {
    const { service } = makeDeps(undefined);
    await assert.rejects(() => service.recordInTx({} as never, { entity: 'account_role', entityId: 'r1', action: 'X' }), /autenticado/);
  });

  it('la actividad de plataforma se marca como PLATFORM, sin usuario de la cuenta', async () => {
    const { service } = makeDeps({ ...CTX, actorType: 'PLATFORM', supportSessionId: 'ss1' });
    const written: Record<string, unknown>[] = [];
    const tx = { auditLog: { create: async (a: { data: Record<string, unknown> }) => (written.push(a.data), a.data) } };
    await service.recordInTx(tx as never, { entity: 'account_role', entityId: 'r1', action: 'X' });
    assert.equal(written[0]!.actorType, 'PLATFORM');
    assert.equal(written[0]!.userId, null);
  });
});
