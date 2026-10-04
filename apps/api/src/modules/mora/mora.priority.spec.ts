import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MoraService } from './mora.service';
import { ArrearsPriorityService } from '../arrears/arrears-priority.service';

const CREDIT = '11111111-1111-4111-8111-111111111111';

function make(opts: { visible?: boolean; episode?: Record<string, unknown> | null } = {}) {
  const calls = { updates: [] as Record<string, unknown>[], audits: [] as Record<string, unknown>[], recompute: 0 };
  let episode: Record<string, unknown> | null = opts.episode === undefined ? { id: 'ep-1', creditId: CREDIT, priority: 'LOW', priorityPinnedAt: null } : opts.episode;
  const tx = {
    $queryRaw: async () => (opts.visible === false ? [] : [{ id: CREDIT, client_id: 'cl1' }]),
    creditArrearEpisode: {
      findFirst: async () => episode,
      update: async (a: { data: Record<string, unknown> }) => {
        calls.updates.push(a.data);
        episode = { ...episode, ...a.data };
        return episode;
      },
    },
  };
  const arrearsPriority = {
    recomputeForCredit: async () => {
      calls.recompute++;
      episode = { ...episode, priority: 'MEDIUM' };
      return 'MEDIUM';
    },
  };
  const service = new MoraService(
    { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never,
    { accountId: 'acc', userId: 'u1', can: () => true } as never,
    { record: async (e: Record<string, unknown>) => void calls.audits.push(e) } as never,
    {} as never,
    arrearsPriority as never,
  );
  return { service, calls };
}

describe('MoraService.setPriority — prioridad del episodio abierto', () => {
  it('fijarla: guarda la prioridad y la marca de fijada, y no recalcula', async () => {
    const { service, calls } = make();
    const res = await service.setPriority(CREDIT, { priority: 'CRITICAL' });
    assert.equal(calls.updates[0]!.priority, 'CRITICAL');
    assert.ok(calls.updates[0]!.priorityPinnedAt instanceof Date);
    assert.equal(calls.recompute, 0);
    assert.deepEqual(res.data, { creditId: CREDIT, episodeId: 'ep-1', priority: 'CRITICAL', pinned: true });
  });

  it('soltarla ({ priority: null }): borra la marca y la recalcula en el acto', async () => {
    const { service, calls } = make({ episode: { id: 'ep-1', creditId: CREDIT, priority: 'CRITICAL', priorityPinnedAt: new Date() } });
    const res = await service.setPriority(CREDIT, { priority: null });
    assert.equal(calls.updates[0]!.priorityPinnedAt, null);
    assert.equal(calls.recompute, 1);
    assert.deepEqual(res.data, { creditId: CREDIT, episodeId: 'ep-1', priority: 'MEDIUM', pinned: false });
  });

  it('se audita antes/después: PRIORITY_PIN al fijar, PRIORITY_AUTO al soltar', async () => {
    const a = make();
    await a.service.setPriority(CREDIT, { priority: 'HIGH' });
    assert.equal(a.calls.audits[0]!.action, 'PRIORITY_PIN');
    assert.deepEqual(a.calls.audits[0]!.before, { creditId: CREDIT, priority: 'LOW', pinned: false });
    assert.deepEqual(a.calls.audits[0]!.after, { creditId: CREDIT, priority: 'HIGH', pinned: true });
    const b = make({ episode: { id: 'ep-1', creditId: CREDIT, priority: 'HIGH', priorityPinnedAt: new Date() } });
    await b.service.setPriority(CREDIT, { priority: null });
    assert.equal(b.calls.audits[0]!.action, 'PRIORITY_AUTO');
  });

  it('un crédito al día (sin episodio abierto) no tiene prioridad → 409 MORA_007', async () => {
    const { service, calls } = make({ episode: null });
    await assert.rejects(
      () => service.setPriority(CREDIT, { priority: 'HIGH' }),
      (err: ConflictException) => err instanceof ConflictException && (err.getResponse() as { code: string }).code === 'MORA_007',
    );
    assert.equal(calls.updates.length, 0);
  });

  it('un crédito fuera de alcance → 404 y no escribe', async () => {
    const { service, calls } = make({ visible: false });
    await assert.rejects(() => service.setPriority(CREDIT, { priority: 'HIGH' }), NotFoundException);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.audits.length, 0);
  });
});

describe('ArrearsPriorityService.recomputeForCredit', () => {
  function makeTx(over: { episode?: Record<string, unknown> | null; credit?: Record<string, unknown> | null; configuration?: unknown } = {}) {
    const updates: Record<string, unknown>[] = [];
    const episode = over.episode === undefined ? { id: 'ep-1', accountId: 'acc', priority: 'LOW', priorityPinnedAt: null } : over.episode;
    const credit = over.credit === undefined ? { outstandingBalance: 50_000, daysPastDue: 20, client: { riskSegment: 'HIGH' } } : over.credit;
    const tx = {
      creditArrearEpisode: {
        findFirst: async (a: { where: Record<string, unknown> }) => {
          assert.equal(a.where.endedAt, null, 'solo el episodio ABIERTO');
          return episode;
        },
        update: async (a: { data: Record<string, unknown> }) => void updates.push(a.data),
      },
      credit: { findFirst: async () => credit },
      account: { findUnique: async () => ({ configuration: over.configuration ?? {} }) },
    };
    return { tx: tx as never, updates };
  }

  it('calcula con saldo + días de mora + riesgo de la persona y lo guarda en el episodio', async () => {
    const { tx, updates } = makeTx();
    // 50 (saldo) + 20 (días) + 30 (riesgo HIGH) = 100 → CRITICAL
    assert.equal(await new ArrearsPriorityService().recomputeForCredit(tx, CREDIT), 'CRITICAL');
    assert.deepEqual(updates, [{ priority: 'CRITICAL' }]);
  });

  it('respeta los umbrales configurados de la cuenta', async () => {
    const { tx } = makeTx({ configuration: { casePriority: { thresholds: { critical: 1000, high: 500, medium: 90 } } } });
    assert.equal(await new ArrearsPriorityService().recomputeForCredit(tx, CREDIT), 'MEDIUM');
  });

  it('con la prioridad fijada a mano NO la pisa', async () => {
    const { tx, updates } = makeTx({ episode: { id: 'ep-1', accountId: 'acc', priority: 'LOW', priorityPinnedAt: new Date() } });
    assert.equal(await new ArrearsPriorityService().recomputeForCredit(tx, CREDIT), 'LOW');
    assert.equal(updates.length, 0);
  });

  it('sin episodio abierto (crédito al día) no hay prioridad: null y no escribe', async () => {
    const { tx, updates } = makeTx({ episode: null });
    assert.equal(await new ArrearsPriorityService().recomputeForCredit(tx, CREDIT), null);
    assert.equal(updates.length, 0);
  });

  it('si ya tiene esa prioridad no vuelve a escribir', async () => {
    const { tx, updates } = makeTx({ episode: { id: 'ep-1', accountId: 'acc', priority: 'CRITICAL', priorityPinnedAt: null } });
    await new ArrearsPriorityService().recomputeForCredit(tx, CREDIT);
    assert.equal(updates.length, 0);
  });
});
