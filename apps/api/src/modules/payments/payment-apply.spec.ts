import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdatedPlan, type PlanScheduleRow } from '@kobrax/shared';
import { applyPayment, creditPatchAfterPayment, creditPatchFromPlan, daysPastDue, planSourceOf, type InstallmentLite } from './payment-apply';

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

/**
 * 🔴 F4/06 · D20 — el método de mora después de un pago. Cuotas 1 (1 jun) y 2 (1 jul) vencidas, hoy
 * 13 jul; paga la 1. El de siempre baja a la 2 (12 días); el bancario sigue desde el 1 jun (42 días).
 */
describe('creditPatchAfterPayment — método de mora (D20)', () => {
  const rows = () => [
    inst('i1', 1, 300, 300, 'PAID', new Date('2026-06-01T00:00:00Z')),
    inst('i2', 2, 300, 0, 'OVERDUE', new Date('2026-07-01T00:00:00Z')),
  ];

  it('de siempre: pagar la cuota más atrasada baja la mora', () => {
    const p = creditPatchAfterPayment({ metadata: meta(), installments: rows(), amount: 300, newBalance: 300, creditPaid: false, now: NOW });
    assert.equal(p.daysPastDue, 12);
  });

  it('bancario: sigue contando desde el primer atraso', () => {
    const p = creditPatchAfterPayment({
      metadata: meta({ arrearsMethod: 'first_default', arrearsSince: '2026-06-01' }),
      installments: rows(),
      amount: 300,
      newBalance: 300,
      creditPaid: false,
      now: NOW,
    });
    assert.equal(p.daysPastDue, 42);
    assert.equal(p.metadata, undefined); // la fecha de primer atraso no cambia
  });

  it('bancario: al quedar al día borra el primer atraso', () => {
    const alDia = [inst('i1', 1, 300, 300, 'PAID', new Date('2026-06-01T00:00:00Z')), inst('i2', 2, 300, 0, 'PENDING', new Date('2026-08-01T00:00:00Z'))];
    const p = creditPatchAfterPayment({
      metadata: meta({ arrearsMethod: 'first_default', arrearsSince: '2026-06-01' }),
      installments: alDia,
      amount: 300,
      newBalance: 300,
      creditPaid: false,
      now: NOW,
    });
    assert.equal(p.daysPastDue, 0);
    assert.equal((p.metadata as Record<string, unknown>).arrearsSince, undefined);
  });

  it('bancario sin cronograma: la fecha avanza pero la mora sigue desde el primer atraso', () => {
    // Cuota congelada: vencía el 1 jun, paga una → la próxima pasa al 1 jul, todavía vencida.
    const p = creditPatchAfterPayment({
      metadata: meta({ nextDueDate: '2026-06-01', arrearsMethod: 'first_default', arrearsSince: '2026-06-01' }),
      installments: [],
      amount: 300,
      newBalance: 700,
      creditPaid: false,
      now: NOW,
    });
    assert.equal(p.metadata?.nextDueDate, '2026-07-01');
    assert.equal(p.daysPastDue, 42);
  });
});

describe('planSourceOf — de dónde sale el plan original', () => {
  const TERMS = { definition: 'agreed_total', principal: 1000, agreedTotal: 1200, repayment: 'installments', installmentsCount: 4, frequency: 'MONTHLY', firstDueDate: '2026-08-01' };

  it('con cronograma guardado, esas filas (y hay que mantener sus copias)', () => {
    const src = planSourceOf({ metadata: {}, installments: [{ number: 2, dueDate: new Date('2026-09-01'), amount: '300.00' }, { number: 1, dueDate: new Date('2026-08-01'), amount: '300.00' }] });
    assert.equal(src?.stored, true);
    assert.deepEqual(src?.rows.map((r) => [r.number, r.dueDate, r.amount]), [[2, '2026-09-01', 300], [1, '2026-08-01', 300]]);
  });

  it('sin filas pero con condiciones, el plan que regenera el motor y las cuotas ya pagadas al registrar', () => {
    const src = planSourceOf({ metadata: { origin: 'manual', terms: TERMS, termsVersion: 1, initialState: { paidInstallments: 1, daysPastDue: 0 } }, installments: [] });
    assert.equal(src?.stored, false);
    assert.equal(src?.rows.length, 4);
    assert.equal(src?.rows[0]?.dueDate, '2026-08-01');
    assert.equal(src?.prepaidInstallments, 1);
    assert.equal(Math.round(src!.rows.reduce((s, r) => s + r.amount * 100, 0)), 120000);
  });

  it('sin filas ni condiciones (préstamo abierto) no hay plan: manda la lógica de siempre', () => {
    assert.equal(planSourceOf({ metadata: { origin: 'manual', installmentAmount: 300 }, installments: [] }), null);
  });
});

describe('creditPatchFromPlan — mora y próxima fecha desde el plan actualizado', () => {
  const ROWS: PlanScheduleRow[] = [
    { number: 1, dueDate: '2026-06-01', amount: 300 },
    { number: 2, dueDate: '2026-07-01', amount: 300 },
    { number: 3, dueDate: '2026-08-01', amount: 300 },
  ];
  const plan = (paid: number) =>
    buildUpdatedPlan({ rows: ROWS, payments: paid > 0 ? [{ id: 'p', amount: paid, registeredAt: '2026-07-13T10:00:00Z' }] : [], asOf: NOW });

  it('sin pagar nada: en mora desde la cuota 1 (42 días) y la fecha no cambia', () => {
    const patch = creditPatchFromPlan({ metadata: meta({ nextDueDate: '2026-06-01' }), plan: plan(0), creditPaid: false, now: NOW });
    assert.equal(patch.daysPastDue, 42);
    assert.equal(patch.metadata, undefined);
  });

  it('🔴 pagos que acumulan lo vencido (600 = cuotas 1 y 2) → al día y la próxima fecha pasa a la cuota 3', () => {
    const patch = creditPatchFromPlan({ metadata: meta({ nextDueDate: '2026-06-01' }), plan: plan(600), creditPaid: false, now: NOW });
    assert.equal(patch.daysPastDue, 0);
    assert.equal(patch.metadata?.nextDueDate, '2026-08-01');
  });

  it('un pago que cubre sólo parte de lo vencido baja la mora a la cuota que sigue impaga', () => {
    const patch = creditPatchFromPlan({ metadata: meta({ nextDueDate: '2026-06-01' }), plan: plan(300), creditPaid: false, now: NOW });
    assert.equal(patch.daysPastDue, 12); // desde el 1/jul (cuota 2), con el método de siempre
    assert.equal(patch.metadata?.nextDueDate, '2026-07-01');
  });

  it('método bancario: mientras quede algo vencido la mora sigue contando desde el primer atraso; al día se borra', () => {
    const bank = { arrearsMethod: 'first_default', arrearsSince: '2026-06-01', nextDueDate: '2026-06-01' };
    const partial = creditPatchFromPlan({ metadata: meta(bank), plan: plan(300), creditPaid: false, now: NOW });
    assert.equal(partial.daysPastDue, 42);
    const current = creditPatchFromPlan({ metadata: meta(bank), plan: plan(600), creditPaid: false, now: NOW });
    assert.equal(current.daysPastDue, 0);
    assert.equal('arrearsSince' in (current.metadata ?? {}), false);
  });

  it('saldado: mora 0 aunque el plan no coincida con el saldo', () => {
    const patch = creditPatchFromPlan({ metadata: meta({ nextDueDate: '2026-06-01' }), plan: plan(0), creditPaid: true, now: NOW });
    assert.equal(patch.daysPastDue, 0);
  });
});

