import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClientImportService } from './client-import.service';

function makeService(opts: { existing?: { id: string; nationalIdHash: string | null }[]; activeCredits?: { clientId: string }[]; prevRun?: unknown } = {}) {
  const calls = {
    create: [] as Record<string, unknown>[],
    update: [] as unknown[],
    softDelete: [] as unknown[],
    runCreate: [] as Record<string, unknown>[],
    audit: [] as { action: string }[],
  };
  const tx = {
    clientImportRun: {
      findFirst: async () => opts.prevRun ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        calls.runCreate.push(args.data);
        return { id: 'run1', ...args.data };
      },
    },
    client: {
      findMany: async () => opts.existing ?? [],
      create: async (args: { data: Record<string, unknown> }) => void calls.create.push(args.data),
      update: async (args: unknown) => void calls.update.push(args),
      updateMany: async (args: unknown) => {
        calls.softDelete.push(args);
        return { count: 1 };
      },
    },
    credit: { findMany: async () => opts.activeCredits ?? [] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'u1' };
  const crypto = { encrypt: (v: string) => `enc(${v})` };
  const blind = { hash: (v?: string | null) => (v ? `h(${v})` : null) };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e) };
  const service = new ClientImportService(prisma as never, tenant as never, crypto as never, blind as never, audit as never);
  return { service, calls };
}

const ROW = { firstName: 'Ana', lastName: 'Lopez', nationalId: 'D1' };

describe('ClientImportService.run', () => {
  it('JSON RECONCILE: crea el nuevo (PII cifrada) y registra la corrida + audit', async () => {
    const { service, calls } = makeService({ existing: [] });
    const r = await service.run({ source: 'json', mode: 'RECONCILE', rows: [ROW] });
    assert.equal(r.created, 1);
    assert.equal(calls.create[0]!.nationalId, 'enc(D1)');
    assert.equal(calls.create[0]!.nationalIdHash, 'h(D1)');
    assert.equal(calls.runCreate.length, 1);
    assert.deepEqual(calls.audit.map((a) => a.action), ['IMPORT']);
  });

  it('dryRun: no escribe nada y devuelve el plan', async () => {
    const { service, calls } = makeService({ existing: [] });
    const r = await service.run({ source: 'json', mode: 'RECONCILE', dryRun: true, rows: [ROW] });
    assert.equal(r.dryRun, true);
    assert.equal(r.created, 1);
    assert.equal(calls.create.length, 0);
    assert.equal(calls.runCreate.length, 0);
    assert.equal(calls.audit.length, 0);
  });

  it('idempotencia: si ya existe una corrida DONE con el mismo file_hash → no-op', async () => {
    const { service, calls } = makeService({ prevRun: { id: 'old', created: 5, updated: 0, softDeleted: 0, needsReview: 0, errors: 0 } });
    const r = await service.run({ source: 'json', mode: 'RECONCILE', rows: [ROW] });
    assert.equal(r.idempotentSkip, true);
    assert.equal(r.created, 5); // refleja la corrida previa
    assert.equal(calls.create.length, 0);
    assert.equal(calls.runCreate.length, 0);
  });

  it('no da de baja a un ausente con crédito activo → needsReview', async () => {
    const { service, calls } = makeService({
      existing: [{ id: 'e1', nationalIdHash: 'h(D9)' }],
      activeCredits: [{ clientId: 'e1' }],
    });
    const r = await service.run({ source: 'json', mode: 'RECONCILE', rows: [] });
    assert.equal(r.needsReview, 1);
    assert.equal(r.softDeleted, 0);
    assert.equal(calls.softDelete.length, 0);
  });

  it('filas inválidas se reportan sin abortar (PERSON sin nombre)', async () => {
    const { service } = makeService({ existing: [] });
    const r = await service.run({ source: 'json', mode: 'UPSERT_ONLY', rows: [{ nationalId: 'D5' }] });
    assert.equal(r.errors, 1);
    assert.equal(r.created, 0);
  });
});
