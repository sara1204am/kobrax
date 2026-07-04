import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, computeArrears, scheduleIsBalanced } from './credit-math';

const FIRST_DUE = new Date('2026-01-15T00:00:00Z');
const sum = (arr: number[]) => Math.round(arr.reduce((s, x) => s + x, 0) * 100) / 100;

describe('buildSchedule', () => {
  it('FRENCH sin interés: cuotas iguales, Σ = principal', () => {
    const items = buildSchedule({ principal: 1200, periodicRate: 0, count: 12, type: 'FRENCH', firstDueDate: FIRST_DUE });
    assert.equal(items.length, 12);
    assert.equal(sum(items.map((i) => i.amount)), 1200);
    assert.equal(sum(items.map((i) => i.principal)), 1200);
    assert.equal(sum(items.map((i) => i.interest)), 0);
    assert.ok(scheduleIsBalanced(1200, items));
  });

  it('FRENCH con interés: cuadra Σ cuotas = principal + Σ interés y amortiza el capital', () => {
    const items = buildSchedule({ principal: 1200, periodicRate: 0.01, count: 12, type: 'FRENCH', firstDueDate: FIRST_DUE });
    assert.equal(items.length, 12);
    assert.equal(sum(items.map((i) => i.principal)), 1200); // amortiza exactamente el capital
    assert.ok(scheduleIsBalanced(1200, items));
    assert.ok(items.every((i) => i.amount > 0));
  });

  it('1 sola cuota: amount = principal + interés', () => {
    const items = buildSchedule({ principal: 500, periodicRate: 0.02, count: 1, type: 'FRENCH', firstDueDate: FIRST_DUE });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.principal, 500);
    assert.equal(items[0]!.interest, 10);
    assert.equal(items[0]!.amount, 510);
  });

  it('FLAT: capital constante, Σ principal = principal', () => {
    const items = buildSchedule({ principal: 999, periodicRate: 0.01, count: 4, type: 'FLAT', firstDueDate: FIRST_DUE });
    assert.equal(sum(items.map((i) => i.principal)), 999);
    assert.ok(scheduleIsBalanced(999, items));
  });

  it('fechas: dueDate de la cuota i = primera + (i-1) meses', () => {
    const items = buildSchedule({ principal: 300, periodicRate: 0, count: 3, type: 'FRENCH', firstDueDate: FIRST_DUE });
    assert.equal(items[0]!.dueDate.getUTCMonth(), 0); // enero
    assert.equal(items[1]!.dueDate.getUTCMonth(), 1); // febrero
    assert.equal(items[2]!.dueDate.getUTCMonth(), 2); // marzo
  });
});

describe('computeArrears', () => {
  const params = { dailyMoratoriumRate: 0.001, penaltyRate: 0.02, graceDays: 0 };

  it('sin cuotas vencidas → todo en cero', () => {
    const r = computeArrears(
      [{ id: 'i1', dueDate: new Date('2026-02-01'), amount: 100, paidAmount: 0, status: 'PENDING' }],
      params,
      new Date('2026-01-20'),
    );
    assert.deepEqual(r, { daysOverdue: 0, overdueAmount: 0, interest: 0, penalty: 0, overdueInstallmentIds: [] });
  });

  it('cuota vencida: días, interés moratorio y penalización', () => {
    const r = computeArrears(
      [{ id: 'i1', dueDate: new Date('2026-01-01T00:00:00Z'), amount: 100, paidAmount: 0, status: 'PENDING' }],
      params,
      new Date('2026-01-11T00:00:00Z'),
    );
    assert.equal(r.daysOverdue, 10);
    assert.equal(r.overdueAmount, 100);
    assert.equal(r.interest, 1); // 100 * 0.001 * 10
    assert.equal(r.penalty, 2); // 100 * 0.02
    assert.deepEqual(r.overdueInstallmentIds, ['i1']);
  });

  it('días de gracia retrasan el inicio de la mora', () => {
    const r = computeArrears(
      [{ id: 'i1', dueDate: new Date('2026-01-01T00:00:00Z'), amount: 100, paidAmount: 0, status: 'PENDING' }],
      { ...params, graceDays: 5 },
      new Date('2026-01-11T00:00:00Z'),
    );
    assert.equal(r.daysOverdue, 5);
    assert.equal(r.interest, 0.5);
  });

  it('excluye cuotas pagadas y usa el saldo no pagado', () => {
    const r = computeArrears(
      [
        { id: 'i1', dueDate: new Date('2026-01-01T00:00:00Z'), amount: 100, paidAmount: 100, status: 'PAID' },
        { id: 'i2', dueDate: new Date('2026-01-01T00:00:00Z'), amount: 100, paidAmount: 40, status: 'PARTIAL' },
      ],
      { ...params, penaltyRate: 0 },
      new Date('2026-01-11T00:00:00Z'),
    );
    assert.deepEqual(r.overdueInstallmentIds, ['i2']);
    assert.equal(r.overdueAmount, 60); // 100 - 40
  });
});
