import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { settlePromisesFromPayments } from './settle-promises';

const DAY = '2026-11-20';
const promise = (over: Record<string, unknown> = {}) => ({
  id: 'pr1',
  scheduledDate: new Date(`${DAY}T00:00:00.000Z`),
  createdAt: new Date(`${DAY}T15:00:00.000Z`),
  details: { amount: 5208.33 },
  ...over,
});

function make(opts: { promises?: ReturnType<typeof promise>[]; paid?: number }) {
  const calls = { windows: [] as { gte: Date; lt: Date }[], activities: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[], reminders: 0 };
  const tx = {
    agendaItem: {
      findMany: async () => opts.promises ?? [promise()],
      update: async (a: { data: Record<string, unknown> }) => void calls.updates.push(a.data),
      updateMany: async () => void (calls.reminders += 1),
    },
    payment: {
      aggregate: async (a: { where: { paymentDate: { gte: Date; lt: Date } } }) => {
        calls.windows.push(a.where.paymentDate);
        return { _sum: { amount: opts.paid ?? 0 } };
      },
    },
    creditArrearEpisode: { findFirst: async () => null },
    creditActivity: {
      create: async (a: { data: Record<string, unknown> }) => {
        calls.activities.push(a.data);
        return { id: 'act1', ...a.data };
      },
    },
    credit: { update: async () => ({}) },
  };
  return { tx, calls };
}

const P = { accountId: 'acc', creditId: 'cr1', clientId: 'cl1', userId: 'u1' };

describe('settlePromisesFromPayments — la promesa se cumple sola con los pagos', () => {
  it('🔴 dos pagos de 3.000 cubren una promesa de 5.208,33: queda cumplida', async () => {
    const { tx, calls } = make({ paid: 6000 });
    const kept = await settlePromisesFromPayments(tx as never, P);
    assert.deepEqual(kept, ['pr1']);
    assert.equal(calls.activities[0]!.result, 'PROMISE_KEPT');
    assert.equal(calls.activities[0]!.type, 'NOTE');
    assert.equal(calls.updates[0]!.status, 'EXECUTED');
    assert.equal(calls.updates[0]!.resultActivityId, 'act1');
    assert.equal(calls.reminders, 1, 'cancela el recordatorio de la promesa');
  });

  it('pagar justo lo prometido la cumple (con tolerancia de céntimos)', async () => {
    const { tx } = make({ paid: 5208.33 });
    assert.deepEqual(await settlePromisesFromPayments(tx as never, P), ['pr1']);
  });

  it('si lo pagado no alcanza, no la da por cumplida ni por incumplida', async () => {
    const { tx, calls } = make({ paid: 3000 });
    assert.deepEqual(await settlePromisesFromPayments(tx as never, P), []);
    assert.equal(calls.activities.length, 0);
    assert.equal(calls.updates.length, 0);
  });

  it('la ventana va del día de la promesa al final del día prometido (con margen horario)', async () => {
    const { tx, calls } = make({ paid: 6000 });
    await settlePromisesFromPayments(tx as never, P);
    const w = calls.windows[0]!;
    assert.equal(w.gte.toISOString(), '2026-11-20T00:00:00.000Z');
    assert.equal(w.lt.toISOString(), '2026-11-21T06:00:00.000Z');
  });

  it('sin promesas pendientes no hace nada', async () => {
    const { tx, calls } = make({ promises: [] });
    assert.deepEqual(await settlePromisesFromPayments(tx as never, P), []);
    assert.equal(calls.windows.length, 0);
  });

  it('una promesa sin monto legible se ignora', async () => {
    const { tx } = make({ promises: [promise({ details: {} })], paid: 9999 });
    assert.deepEqual(await settlePromisesFromPayments(tx as never, P), []);
  });
});
