import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promiseStatus, serializePromises, type PromiseRow } from './mora-promises';

const NOW = new Date('2026-10-01T15:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

function row(over: Partial<PromiseRow> = {}): PromiseRow {
  return {
    id: 'p1',
    status: 'SCHEDULED',
    scheduledDate: d('2026-10-10'),
    details: { amount: 500, paymentMethodCode: 'CASH' },
    observations: null,
    assigneeId: 'u1',
    resultActivityId: null,
    createdAt: new Date('2026-09-28T10:00:00Z'),
    ...over,
  };
}

describe('promiseStatus — en qué está una promesa', () => {
  it('agendada para hoy o adelante: vigente', () => {
    assert.equal(promiseStatus(row({ scheduledDate: d('2026-10-01') }), undefined, NOW), 'ACTIVE');
    assert.equal(promiseStatus(row({ scheduledDate: d('2026-10-10') }), undefined, NOW), 'ACTIVE');
  });

  it('🔴 la fecha pasó y nadie la cerró: VENCIDA, no incumplida (no se sabe si pagó)', () => {
    assert.equal(promiseStatus(row({ scheduledDate: d('2026-09-30') }), undefined, NOW), 'OVERDUE');
  });

  it('ejecutada con el desenlace de la gestión: cumplida o incumplida', () => {
    assert.equal(promiseStatus(row({ status: 'EXECUTED' }), 'PROMISE_KEPT', NOW), 'KEPT');
    assert.equal(promiseStatus(row({ status: 'EXECUTED' }), 'PROMISE_BROKEN', NOW), 'BROKEN');
  });

  it('ejecutada sin desenlace de promesa (dato viejo): EXECUTED, sin inventar cumplimiento', () => {
    assert.equal(promiseStatus(row({ status: 'EXECUTED' }), undefined, NOW), 'EXECUTED');
    assert.equal(promiseStatus(row({ status: 'EXECUTED' }), 'DONE', NOW), 'EXECUTED');
  });

  it('cancelada y reagendada se dicen como son', () => {
    assert.equal(promiseStatus(row({ status: 'CANCELLED' }), undefined, NOW), 'CANCELLED');
    assert.equal(promiseStatus(row({ status: 'RESCHEDULED' }), undefined, NOW), 'RESCHEDULED');
  });

  it('el día de la promesa cuenta hasta que termina el día (UTC), no desde la hora', () => {
    assert.equal(promiseStatus(row({ scheduledDate: d('2026-10-01') }), undefined, new Date('2026-10-01T23:59:00Z')), 'ACTIVE');
    assert.equal(promiseStatus(row({ scheduledDate: d('2026-10-01') }), undefined, new Date('2026-10-02T00:01:00Z')), 'OVERDUE');
  });
});

describe('serializePromises', () => {
  it('la más reciente primero', () => {
    const out = serializePromises(
      [row({ id: 'a', scheduledDate: d('2026-08-01') }), row({ id: 'c', scheduledDate: d('2026-10-10') }), row({ id: 'b', scheduledDate: d('2026-09-05') })],
      new Map(),
      NOW,
    );
    assert.deepEqual(out.map((p) => p.id), ['c', 'b', 'a']);
  });

  it('monto y método salen de los detalles; lo que falta llega ausente, no en 0', () => {
    const [p] = serializePromises([row({ details: {} })], new Map(), NOW);
    assert.equal(p!.amount, undefined);
    assert.equal(p!.paymentMethodCode, undefined);
    const [q] = serializePromises([row({ details: { amount: 500, paymentMethodCode: 'QR', bankCode: 'BNB' } })], new Map(), NOW);
    assert.equal(q!.amount, 500);
    assert.equal(q!.paymentMethodCode, 'QR');
    assert.equal(q!.bankCode, 'BNB');
  });

  it('un monto que no es número no se cuela', () => {
    const [p] = serializePromises([row({ details: { amount: '500' } })], new Map(), NOW);
    assert.equal(p!.amount, undefined);
  });

  it('el desenlace sale de la actividad enlazada', () => {
    const [p] = serializePromises([row({ status: 'EXECUTED', resultActivityId: 'act1' })], new Map([['act1', 'PROMISE_KEPT']]), NOW);
    assert.equal(p!.status, 'KEPT');
    assert.equal(p!.promiseDate, '2026-10-10');
  });

  it('el día de la promesa sale como YYYY-MM-DD', () => {
    const [p] = serializePromises([row({ scheduledDate: d('2026-10-03') })], new Map(), NOW);
    assert.equal(p!.promiseDate, '2026-10-03');
  });
});
