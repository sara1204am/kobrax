import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPayment, daysPastDue, type InstallmentLite } from './payment-apply';

const inst = (id: string, number: number, amount: number, paidAmount = 0, status = 'PENDING', dueDate = new Date('2026-06-01')): InstallmentLite => ({ id, number, amount, paidAmount, status, dueDate });

describe('applyPayment', () => {
  it('aplica de la cuota más antigua a la más reciente (full + partial)', () => {
    const r = applyPayment([inst('i1', 1, 100), inst('i2', 2, 100)], 150);
    assert.equal(r.applied, 150);
    assert.equal(r.leftover, 0);
    assert.deepEqual(r.updates.map((u) => [u.id, u.paidAmount, u.status]), [['i1', 100, 'PAID'], ['i2', 50, 'PARTIAL']]);
  });

  it('deja leftover si el monto excede lo adeudado', () => {
    const r = applyPayment([inst('i1', 1, 100), inst('i2', 2, 100)], 250);
    assert.equal(r.applied, 200);
    assert.equal(r.leftover, 50);
    assert.equal(r.updates.length, 2);
    assert.ok(r.updates.every((u) => u.status === 'PAID'));
  });

  it('omite las cuotas ya pagadas y respeta el saldo parcial', () => {
    const r = applyPayment([inst('i1', 1, 100, 100, 'PAID'), inst('i2', 2, 100, 40, 'PARTIAL')], 60);
    assert.deepEqual(r.updates.map((u) => [u.id, u.paidAmount, u.status]), [['i2', 100, 'PAID']]);
  });
});

describe('daysPastDue', () => {
  it('cuenta desde la cuota vencida más antigua no pagada', () => {
    const d = daysPastDue([inst('i1', 1, 100, 0, 'OVERDUE', new Date('2026-06-01T00:00:00Z'))], new Date('2026-06-11T00:00:00Z'));
    assert.equal(d, 10);
  });
  it('0 si todo está pagado o al día', () => {
    assert.equal(daysPastDue([inst('i1', 1, 100, 100, 'PAID', new Date('2026-01-01'))], new Date('2026-06-11')), 0);
    assert.equal(daysPastDue([inst('i1', 1, 100, 0, 'PENDING', new Date('2026-12-01'))], new Date('2026-06-11')), 0);
  });
});
