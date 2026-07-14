import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPayment, creditPatchAfterPayment, daysPastDue, type InstallmentLite } from './payment-apply';

const inst = (id: string, number: number, amount: number, paidAmount = 0, status = 'PENDING', dueDate = new Date('2026-06-01')): InstallmentLite => ({ id, number, amount, paidAmount, status, dueDate });

const NOW = new Date('2026-07-13T12:00:00.000Z');
/** Metadata de un crédito del móvil: cuota congelada, sin cronograma. */
const meta = (over: Record<string, unknown> = {}) => ({
  frequency: 'MONTHLY',
  origin: 'manual',
  installmentAmount: 300,
  nextDueDate: '2026-07-01',
  ...over,
});

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

/**
 * Crédito SIN cronograma — el que nace en el móvil (spec §4.1: la cuota es un dato, no una derivación).
 * Antes de este slice, `applyPayment` devolvía `applied: 0` y el saldo quedaba intacto: el pago se
 * registraba y la deuda no bajaba. Estos tests son la red de ese agujero.
 */
describe('creditPatchAfterPayment — crédito sin cronograma', () => {
  it('la próxima fecha avanza un período cuando el pago CUBRE la cuota', () => {
    const p = creditPatchAfterPayment({ metadata: meta(), installments: [], amount: 300, newBalance: 700, creditPaid: false, now: NOW });
    assert.equal(p.metadata?.nextDueDate, '2026-08-01');
    assert.equal(p.daysPastDue, 0); // la fecha nueva es futura ⇒ ya no está en mora
  });

  it('un pago PARCIAL no mueve la fecha: "la cuota permanece vigente por el remanente" (§5.4)', () => {
    const p = creditPatchAfterPayment({ metadata: meta(), installments: [], amount: 100, newBalance: 900, creditPaid: false, now: NOW });
    assert.equal(p.metadata, undefined); // no se toca el metadata
    assert.equal(p.daysPastDue, 12); // sigue en mora desde el 1 de julio
  });

  it('la fecha avanza según la frecuencia, no siempre un mes', () => {
    const semanal = creditPatchAfterPayment({ metadata: meta({ frequency: 'WEEKLY' }), installments: [], amount: 300, newBalance: 700, creditPaid: false, now: NOW });
    assert.equal(semanal.metadata?.nextDueDate, '2026-07-08');
    const diario = creditPatchAfterPayment({ metadata: meta({ frequency: 'DAILY' }), installments: [], amount: 300, newBalance: 700, creditPaid: false, now: NOW });
    assert.equal(diario.metadata?.nextDueDate, '2026-07-02');
  });

  it('crédito saldado ⇒ mora 0 y la fecha no avanza (ya no hay próxima cuota)', () => {
    const p = creditPatchAfterPayment({ metadata: meta(), installments: [], amount: 1000, newBalance: 0, creditPaid: true, now: NOW });
    assert.equal(p.daysPastDue, 0);
    assert.equal(p.metadata, undefined);
  });

  it('cartera importada: el pago NO le toca la mora — manda el archivo (§6)', () => {
    const p = creditPatchAfterPayment({ metadata: meta({ origin: 'import' }), installments: [], amount: 100, newBalance: 900, creditPaid: false, now: NOW });
    assert.equal(p.daysPastDue, undefined); // ni se escribe el campo
  });

  it('sin cuota congelada (el archivo no la trajo) no se inventa un avance de fecha', () => {
    const p = creditPatchAfterPayment({ metadata: meta({ installmentAmount: undefined }), installments: [], amount: 500, newBalance: 500, creditPaid: false, now: NOW });
    assert.equal(p.metadata, undefined);
    assert.equal(p.daysPastDue, 12);
  });
});

describe('creditPatchAfterPayment — crédito CON cronograma (no hay regresión)', () => {
  it('la mora sigue saliendo de las cuotas y la fecha del metadata no se toca', () => {
    const vencida = inst('i1', 1, 300, 0, 'OVERDUE', new Date('2026-07-01T00:00:00Z'));
    const p = creditPatchAfterPayment({ metadata: meta(), installments: [vencida], amount: 100, newBalance: 900, creditPaid: false, now: NOW });
    assert.equal(p.daysPastDue, 12);
    assert.equal(p.metadata, undefined); // con cronograma, la próxima fecha se deriva; no se persiste
  });
});
