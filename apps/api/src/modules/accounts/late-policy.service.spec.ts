import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LatePolicyService } from './late-policy.service';

type Row = { id: string; version: number; kind: 'NONE' | 'ANNUAL_RATE'; annualRate: number | null; dayCount: number | null; graceDays: number; capPctOfPrincipal: number | null; effectiveFrom: Date; createdBy: string | null };

const row = (over: Partial<Row> = {}): Row => ({ id: 'v1', version: 1, kind: 'NONE', annualRate: null, dayCount: null, graceDays: 0, capPctOfPrincipal: null, effectiveFrom: new Date('2026-11-21T00:00:00Z'), createdBy: null, ...over });

function make(existing: Row | null, opts: { createFails?: string } = {}) {
  const calls = { created: [] as Record<string, unknown>[], audits: [] as Record<string, unknown>[], locks: 0 };
  const tx = {
    $executeRaw: async () => (calls.locks++, 0),
    latePolicyVersion: {
      findFirst: async () => existing,
      create: async (args: { data: Record<string, unknown> }) => {
        if (opts.createFails) throw Object.assign(new Error('dup'), { code: opts.createFails });
        calls.created.push(args.data);
        return row({ id: 'new', version: args.data.version as number, kind: args.data.kind as Row['kind'], annualRate: args.data.annualRate as number | null, dayCount: args.data.dayCount as number | null, graceDays: args.data.graceDays as number, capPctOfPrincipal: args.data.capPctOfPrincipal as number | null, createdBy: 'u1' });
      },
    },
    user: { findFirst: async () => ({ email: 'ana@x.com', profile: { firstName: 'Ana', lastName: 'Paz' } }) },
  };
  const service = new LatePolicyService(
    { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as never,
    { accountId: 'acc-A', userId: 'u1' } as never,
    { recordInTx: async (_tx: unknown, e: Record<string, unknown>) => void calls.audits.push(e) } as never,
  );
  return { service, calls };
}

describe('LatePolicyService — interés moratorio apagado por defecto y versionado (F17)', () => {
  it('una cuenta sin versiones se lee como «sin cargos» y no escribe nada', async () => {
    const { service, calls } = make(null);
    const p = await service.current();
    assert.equal(p.kind, 'NONE');
    assert.equal(p.annualRate, null);
    assert.equal(calls.created.length, 0);
  });

  it('pedir «sin cargos» en una cuenta que ya lo está NO crea versión', async () => {
    const { service, calls } = make(null);
    await service.change({ kind: 'NONE' });
    assert.equal(calls.created.length, 0);
    assert.equal(calls.audits.length, 0);
  });

  it('activar crea la versión siguiente con sus parámetros, quién la hizo, y la audita en la misma transacción', async () => {
    const { service, calls } = make(row());
    const p = await service.change({ kind: 'ANNUAL_RATE', annualRate: 18, dayCount: 365, graceDays: 2, capPctOfPrincipal: 30 });
    assert.deepEqual(calls.created[0], { accountId: 'acc-A', scope: 'ACCOUNT', version: 2, createdBy: 'u1', kind: 'ANNUAL_RATE', annualRate: 18, dayCount: 365, graceDays: 2, capPctOfPrincipal: 30 });
    assert.equal(p.version, 2);
    assert.equal(p.createdByName, 'Ana Paz');
    assert.equal(calls.locks, 1);
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0]!.entity, 'late_policy');
    assert.deepEqual((calls.audits[0]!.before as { kind: string }).kind, 'NONE');
    assert.deepEqual((calls.audits[0]!.after as { annualRate: number }).annualRate, 18);
  });

  it('volver a guardar lo mismo no ensucia el historial (idempotente)', async () => {
    const { service, calls } = make(row({ version: 2, kind: 'ANNUAL_RATE', annualRate: 18, dayCount: 365, graceDays: 0 }));
    await service.change({ kind: 'ANNUAL_RATE', annualRate: 18, dayCount: 365 });
    assert.equal(calls.created.length, 0);
  });

  it('apagarlo después de activarlo crea una versión NONE sin parámetros (los créditos ya sellados no cambian)', async () => {
    const { service, calls } = make(row({ version: 2, kind: 'ANNUAL_RATE', annualRate: 18, dayCount: 365 }));
    await service.change({ kind: 'NONE' });
    assert.equal(calls.created[0]!.version, 3);
    assert.equal(calls.created[0]!.kind, 'NONE');
    assert.equal(calls.created[0]!.annualRate, null);
    assert.equal(calls.created[0]!.dayCount, null);
  });

  it('una política incoherente se rechaza antes de tocar la base', async () => {
    const { service, calls } = make(row());
    await assert.rejects(() => service.change({ kind: 'ANNUAL_RATE', dayCount: 365 }), /no es válida/);
    await assert.rejects(() => service.change({ kind: 'ANNUAL_RATE', annualRate: 500, dayCount: 365 }), /no es válida/);
    await assert.rejects(() => service.change({ kind: 'NONE', annualRate: 5 }), /no es válida/);
    assert.equal(calls.locks, 0);
    assert.equal(calls.created.length, 0);
  });

  it('dos administradores a la vez: la violación del único sale como conflicto accionable', async () => {
    const { service } = make(row(), { createFails: 'P2002' });
    await assert.rejects(() => service.change({ kind: 'ANNUAL_RATE', annualRate: 12, dayCount: 360 }), /cambió mientras la guardabas/);
  });
});
