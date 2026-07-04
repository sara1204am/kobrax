import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FieldService } from './field.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

function makeService(opts: { visit?: unknown; stop?: unknown; case?: unknown } = {}) {
  const calls = { visitCreate: [] as Record<string, unknown>[], stopUpdate: 0, evidence: [] as Record<string, unknown>[], events: [] as string[], audit: [] as string[] };
  const tx = {
    collectionCase: { findFirst: async () => opts.case ?? { id: 'c1' }, update: async () => ({}) },
    routeStop: { findFirst: async () => opts.stop ?? { id: 's1' }, update: async () => { calls.stopUpdate += 1; return {}; } },
    caseActivity: { create: async () => ({}) },
    user: { update: async () => ({}) },
    fieldVisit: {
      findFirst: async () => opts.visit ?? { id: 'v1', latitude: -16.5, longitude: -68.15 },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.visitCreate.push(args.data);
        return { id: 'v1', ...args.data };
      },
    },
    fieldEvidence: {
      create: async (args: { data: Record<string, unknown> }) => {
        calls.evidence.push(args.data);
        return { id: 'e1', ...args.data };
      },
    },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'collector-1' };
  const audit = { record: async (e: { action: string }) => void calls.audit.push(e.action) };
  const events = { emit: (name: string) => void calls.events.push(name) };
  const service = new FieldService(prisma as never, tenant as never, audit as never, events as never);
  return { service, calls };
}

describe('FieldService.createVisit', () => {
  it('exige un objetivo (caso o parada)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.createVisit({ lat: -16.5, lng: -68.15, outcome: 'CONTACTED' as never }), 'VISIT_TARGET');
  });

  it('valida el GPS', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.createVisit({ caseId: 'c1', lat: 999, lng: 0, outcome: 'CONTACTED' as never } as never), 'VISIT_GPS');
  });

  it('registra la visita, marca la parada y emite collector.location', async () => {
    const { service, calls } = makeService();
    const r = await service.createVisit({ routeStopId: 's1', lat: -16.5, lng: -68.15, outcome: 'PROMISE_TO_PAY' as never });
    assert.equal(calls.visitCreate[0]!.collectorId, 'collector-1');
    assert.equal(calls.visitCreate[0]!.outcome, 'PROMISE_TO_PAY');
    assert.equal(calls.stopUpdate, 1);
    assert.ok(calls.events.includes('collector.location'));
    assert.ok(r.id);
  });
});

describe('FieldService.addEvidence', () => {
  const HELLO_B64 = Buffer.from('hello').toString('base64');
  const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  it('rechaza si el hash no coincide con el contenido (EVIDENCE_001)', async () => {
    const { service } = makeService();
    await rejectsWithCode(service.addEvidence('v1', { type: 'PHOTO' as never, fileUrl: 'u', fileHash: 'deadbeef', content: HELLO_B64 }), 'EVIDENCE_001');
  });

  it('sella la evidencia cuando el hash coincide', async () => {
    const { service, calls } = makeService();
    const r = await service.addEvidence('v1', { type: 'PHOTO' as never, fileUrl: 'u', fileHash: HELLO_SHA, content: HELLO_B64 });
    assert.equal(calls.evidence[0]!.fileHash, HELLO_SHA);
    assert.deepEqual(calls.audit, ['CREATE']);
    assert.equal(r.fileHash, HELLO_SHA);
  });
});
