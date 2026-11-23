import { describe, expect, it } from 'vitest';
import { CreditDefinition, PaymentFrequency, RepaymentForm } from '../enums/credit.enum.js';
import { calculateCredit } from './credit-engine.js';
import {
  allocatePayments,
  buildUpdatedPlan,
  diffAllocations,
  overdueAmountFromBalance,
  type PlanPayment,
  type PlanScheduleRow,
} from './payment-plan.js';

/** El crédito de la auditoría: 120.000 prestados, 125.000 acordados, 24 cuotas mensuales, primera el 19/11/2026. */
const CREDIT = calculateCredit({
  definition: CreditDefinition.AGREED_TOTAL,
  principal: 120000,
  agreedTotal: 125000,
  repayment: RepaymentForm.INSTALLMENTS,
  installmentsCount: 24,
  frequency: PaymentFrequency.MONTHLY,
  firstDueDate: '2026-11-19',
});
const ROWS: PlanScheduleRow[] = CREDIT.schedule!.map((r) => ({ number: r.number, dueDate: r.dueDate, amount: r.amount }));

/** «Hoy» de la auditoría: la cuota 1 venció ayer. */
const TODAY = new Date('2026-11-20T15:00:00Z');
const pay = (id: string, amount: number, registeredAt: string): PlanPayment => ({ id, amount, registeredAt });

describe('el plan original que sirve de base', () => {
  it('24 cuotas de 5.208,33 y la última absorbe el redondeo: el plan suma exactamente 125.000', () => {
    expect(ROWS).toHaveLength(24);
    expect(ROWS[0]!.amount).toBe(5208.33);
    expect(ROWS[23]!.amount).toBe(5208.41);
    expect(Math.round(ROWS.reduce((s, r) => s + r.amount * 100, 0))).toBe(12_500_000);
  });
});

describe('buildUpdatedPlan — el caso de la auditoría', () => {
  it('sin pagos: la cuota 1 vencida, toda la deuda pendiente y en mora de 1 día', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, asOf: TODAY });
    expect(plan.situation).toBe('OVERDUE');
    expect(plan.balance).toBe(125000);
    expect(plan.overdueAmount).toBe(5208.33);
    expect(plan.overdueCount).toBe(1);
    expect(plan.baseDaysPastDue).toBe(1);
    expect(plan.nextPayment).toEqual({ number: 1, dueDate: '2026-11-19', amount: 5208.33, overdue: true });
  });

  it('el día del vencimiento todavía no está vencida', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, asOf: new Date('2026-11-19T23:00:00Z') });
    expect(plan.overdueAmount).toBe(0);
    expect(plan.situation).toBe('CURRENT');
    expect(plan.baseDaysPastDue).toBe(0);
  });

  it('1) pago exacto de una cuota: vigente y el próximo pago es la cuota 2 completa', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 5208.33, '2026-11-20T10:00:00Z')], asOf: TODAY });
    expect(plan.rows[0]).toMatchObject({ status: 'PAID', paid: 5208.33, pending: 0 });
    expect(plan.rows[1]).toMatchObject({ status: 'PENDING', paid: 0 });
    expect(plan.situation).toBe('CURRENT');
    expect(plan.nextPayment).toEqual({ number: 2, dueDate: '2026-12-19', amount: 5208.33, overdue: false });
  });

  it('2) pago superior a una cuota: 6.000 → cuota 1 pagada, cuota 2 parcial (791,67 pagados, 4.416,66 pendientes)', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 6000, '2026-11-20T10:00:00Z')], asOf: TODAY });
    expect(plan.rows[0]).toMatchObject({ status: 'PAID', pending: 0 });
    expect(plan.rows[1]).toMatchObject({ status: 'PARTIAL', paid: 791.67, pending: 4416.66 });
    expect(plan.rows.slice(2).every((r) => r.status === 'PENDING')).toBe(true);
    expect(plan.balance).toBe(119000);
    expect(plan.overdueAmount).toBe(0);
    expect(plan.overdueCount).toBe(0);
    expect(plan.situation).toBe('CURRENT');
    expect(plan.baseDaysPastDue).toBe(0);
    expect(plan.nextPayment).toEqual({ number: 2, dueDate: '2026-12-19', amount: 4416.66, overdue: false });
    // La traza del pago original y de sus aplicaciones.
    expect(plan.payments[0]).toMatchObject({
      paymentId: 'p1',
      amount: 6000,
      applied: 6000,
      unapplied: 0,
      balanceAfter: 119000,
      allocations: [
        { installmentNumber: 1, amount: 5208.33, coversInstallment: true },
        { installmentNumber: 2, amount: 791.67, coversInstallment: false },
      ],
    });
  });

  it('3) un pago que cubre varias cuotas: 10.416,66 → cuotas 1 y 2 pagadas, próximo pago la cuota 3', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 10416.66, '2026-11-20T10:00:00Z')], asOf: TODAY });
    expect(plan.rows.slice(0, 2).map((r) => r.status)).toEqual(['PAID', 'PAID']);
    expect(plan.nextPayment).toEqual({ number: 3, dueDate: '2027-01-19', amount: 5208.33, overdue: false });
    expect(plan.balance).toBe(114583.34);
  });

  it('4 y 7) un pago que no alcanza la cuota vencida: sigue en mora y el próximo pago es lo que falta', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 3000, '2026-11-20T10:00:00Z')], asOf: TODAY });
    expect(plan.rows[0]).toMatchObject({ status: 'OVERDUE', paid: 3000, pending: 2208.33 });
    expect(plan.situation).toBe('OVERDUE');
    expect(plan.overdueAmount).toBe(2208.33);
    expect(plan.baseDaysPastDue).toBe(1);
    expect(plan.nextPayment).toEqual({ number: 1, dueDate: '2026-11-19', amount: 2208.33, overdue: true });
  });

  it('8) varios pagos acumulan: 3.000 + 3.000 deja lo mismo que un pago de 6.000 y el crédito vigente', () => {
    const two = buildUpdatedPlan({
      rows: ROWS,
      payments: [pay('a', 3000, '2026-11-20T09:00:00Z'), pay('b', 3000, '2026-11-20T10:00:00Z')],
      asOf: TODAY,
    });
    const one = buildUpdatedPlan({ rows: ROWS, payments: [pay('a', 6000, '2026-11-20T09:00:00Z')], asOf: TODAY });
    expect(two.rows).toEqual(one.rows);
    expect(two.situation).toBe('CURRENT');
    expect(two.nextPayment).toEqual(one.nextPayment);
  });

  it('5) pago anticipado sin mora: se aplica a las cuotas en orden y las fechas del plan no cambian', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 6000, '2026-11-10T10:00:00Z')], asOf: new Date('2026-11-10T12:00:00Z') });
    expect(plan.situation).toBe('CURRENT');
    expect(plan.rows[0]).toMatchObject({ status: 'PAID', dueDate: '2026-11-19', amount: 5208.33 });
    expect(plan.rows[1]).toMatchObject({ status: 'PARTIAL', dueDate: '2026-12-19', amount: 5208.33 });
    expect(plan.rows[2]).toMatchObject({ amount: 5208.33 }); // una cuota futura NO cambia de importe por un pago anticipado
  });

  it('6) un pago que cubre la mora pero deja otras cuotas pendientes → vigente', () => {
    // Hoy 20/01/2027: vencidas las cuotas 1, 2 y 3 (15.624,99). Se pagan justo esas tres.
    const asOf = new Date('2027-01-20T12:00:00Z');
    const before = buildUpdatedPlan({ rows: ROWS, asOf });
    expect(before.overdueCount).toBe(3);
    expect(before.overdueAmount).toBe(15624.99);
    const after = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 15624.99, '2027-01-20T10:00:00Z')], asOf });
    expect(after.situation).toBe('CURRENT');
    expect(after.overdueAmount).toBe(0);
    expect(after.nextPayment).toEqual({ number: 4, dueDate: '2027-02-19', amount: 5208.33, overdue: false });
  });

  it('varias cuotas vencidas: el próximo pago es TODO lo vencido, con la fecha de la más antigua', () => {
    const asOf = new Date('2027-01-20T12:00:00Z');
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 3000, '2027-01-20T10:00:00Z')], asOf });
    expect(plan.situation).toBe('OVERDUE');
    expect(plan.overdueAmount).toBe(12624.99);
    expect(plan.overdueCount).toBe(3);
    expect(plan.nextPayment).toEqual({ number: 1, dueDate: '2026-11-19', amount: 12624.99, overdue: true });
    expect(plan.baseDaysPastDue).toBe(62);
  });
});

describe('orden de imputación', () => {
  it('manda el orden de REGISTRO, no el de la fecha de cobro', () => {
    // Registrado primero: 5.208,33. Registrado después (aunque cobrado antes): 1.000. La imputación sigue el registro.
    const payments = [pay('late', 1000, '2026-11-20T12:00:00Z'), pay('first', 5208.33, '2026-11-20T09:00:00Z')];
    const { allocations } = allocatePayments({ rows: ROWS, payments });
    expect(allocations).toEqual([
      { paymentId: 'first', installmentNumber: 1, amount: 5208.33 },
      { paymentId: 'late', installmentNumber: 2, amount: 1000 },
    ]);
  });

  it('un pago nuevo NO reescribe cómo se aplicaron los anteriores', () => {
    const base = [pay('a', 6000, '2026-11-20T09:00:00Z')];
    const antes = allocatePayments({ rows: ROWS, payments: base }).allocations;
    const despues = allocatePayments({ rows: ROWS, payments: [...base, pay('b', 500, '2026-11-21T09:00:00Z')] }).allocations;
    expect(despues.slice(0, antes.length)).toEqual(antes);
  });

  it('el empate de hora se resuelve por el orden de entrada (estable)', () => {
    const at = '2026-11-20T09:00:00Z';
    const { allocations } = allocatePayments({ rows: ROWS, payments: [pay('x', 5208.33, at), pay('y', 100, at)] });
    expect(allocations.map((a) => a.paymentId)).toEqual(['x', 'y']);
  });
});

describe('cuotas pagadas antes de registrar el crédito', () => {
  it('cuentan como pagadas en el plan, pero no como cobradas por Kobrax; el reparto empieza en la cuota siguiente', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, prepaidInstallments: 3, payments: [pay('p1', 1000, '2026-11-20T10:00:00Z')], asOf: new Date('2027-01-20T12:00:00Z') });
    expect(plan.rows.slice(0, 3).every((r) => r.status === 'PAID' && r.prepaid)).toBe(true);
    expect(plan.prepaidAmount).toBe(15624.99);
    expect(plan.collectedAmount).toBe(1000);
    expect(plan.rows[3]).toMatchObject({ paid: 1000, pending: 4208.33, prepaid: false });
    expect(plan.payments[0]!.allocations).toEqual([{ installmentNumber: 4, amount: 1000, coversInstallment: false }]);
    expect(plan.overdueAmount).toBe(0); // cuotas 1-3 prepagas: lo único vencido (la 4 vence el 19/02) no lo está
  });
});

describe('saldo y excedentes', () => {
  it('un pago que cubre todo deja el crédito saldado', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 125000, '2026-11-20T10:00:00Z')], asOf: TODAY });
    expect(plan.situation).toBe('PAID');
    expect(plan.balance).toBe(0);
    expect(plan.nextPayment).toBeNull();
  });

  it('lo que no cabe en el plan queda como no aplicado y no se inventa una cuota', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, payments: [pay('p1', 125000.5, '2026-11-20T10:00:00Z')], asOf: TODAY });
    expect(plan.unappliedAmount).toBe(0.5);
    expect(plan.payments[0]).toMatchObject({ applied: 125000, unapplied: 0.5 });
  });
});

describe('invariantes (barrido determinista de secuencias de pagos)', () => {
  // LCG determinista: sin azar real, el fallo se puede reproducir.
  const seq = (seed: number): (() => number) => {
    let s = seed;
    return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  };

  it('saldo = plan − prepago − aplicado; vencido ≤ saldo; Σ por pago = monto; ninguna cuota pasa de su importe', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = seq(seed);
      const n = 1 + Math.floor(rnd() * 8);
      const payments = Array.from({ length: n }, (_, i) =>
        pay(`p${i}`, Math.round(rnd() * 30000 * 100) / 100 + 0.01, new Date(Date.UTC(2026, 10, 1 + i, 9)).toISOString()),
      );
      const prepaid = Math.floor(rnd() * 4);
      const asOf = new Date(Date.UTC(2026, 10 + Math.floor(rnd() * 8), 20));
      const plan = buildUpdatedPlan({ rows: ROWS, prepaidInstallments: prepaid, payments, asOf });

      const cents = (x: number): number => Math.round(x * 100);
      const sumRows = plan.rows.reduce((s, r) => s + cents(r.pending), 0);
      expect(sumRows).toBe(cents(plan.balance));
      expect(cents(plan.balance)).toBe(cents(plan.planTotal) - cents(plan.prepaidAmount) - cents(plan.collectedAmount));
      expect(cents(plan.overdueAmount)).toBeLessThanOrEqual(cents(plan.balance));
      for (const r of plan.rows) {
        expect(cents(r.paid) + cents(r.pending)).toBe(cents(r.amount));
        expect(r.pending).toBeGreaterThanOrEqual(0);
      }
      for (const b of plan.payments) expect(cents(b.applied) + cents(b.unapplied)).toBe(cents(b.amount));
      // Vigente ⇔ nada vencido pendiente (y no saldado).
      expect(plan.situation === 'OVERDUE').toBe(plan.overdueAmount > 0);
    }
  });
});

describe('persistido vs reproducido', () => {
  const payments = [pay('a', 6000, '2026-11-20T09:00:00Z'), pay('b', 1200, '2026-11-21T09:00:00Z')];

  it('con las aplicaciones persistidas el plan es idéntico al reproducido', () => {
    const { allocations } = allocatePayments({ rows: ROWS, payments });
    const replayed = buildUpdatedPlan({ rows: ROWS, payments, asOf: TODAY });
    const persisted = buildUpdatedPlan({ rows: ROWS, payments, allocations, asOf: TODAY });
    expect(persisted.rows).toEqual(replayed.rows);
    expect(persisted.balance).toBe(replayed.balance);
  });

  it('el verificador no ve diferencias en lo coherente y señala exactamente lo desviado', () => {
    const { allocations } = allocatePayments({ rows: ROWS, payments });
    expect(diffAllocations(allocations, allocations)).toEqual([]);
    const tampered = allocations.map((a) => (a.paymentId === 'a' && a.installmentNumber === 2 ? { ...a, amount: a.amount + 1 } : a));
    expect(diffAllocations(allocations, tampered)).toEqual([{ paymentId: 'a', installmentNumber: 2, expected: 791.67, persisted: 792.67 }]);
    expect(diffAllocations(allocations, allocations.slice(1))).toHaveLength(1); // falta una aplicación
  });

  it('una compensación (monto negativo) devuelve lo aplicado, sin tocar las otras filas', () => {
    const { allocations } = allocatePayments({ rows: ROWS, payments: [pay('a', 6000, '2026-11-20T09:00:00Z')] });
    const reversal = allocations.map((a) => ({ ...a, amount: -a.amount }));
    const plan = buildUpdatedPlan({ rows: ROWS, allocations: [...allocations, ...reversal], asOf: TODAY });
    expect(plan.balance).toBe(125000);
    expect(plan.rows[0]!.status).toBe('OVERDUE');
  });
});

describe('pureza', () => {
  it('no muta lo que recibe y es determinista', () => {
    const rows = ROWS.map((r) => Object.freeze({ ...r }));
    const payments = Object.freeze([Object.freeze(pay('a', 6000, '2026-11-20T09:00:00Z'))]);
    const a = buildUpdatedPlan({ rows, payments, asOf: TODAY });
    const b = buildUpdatedPlan({ rows, payments, asOf: TODAY });
    expect(a).toEqual(b);
  });
});

describe('reparto incremental (lo que hace el servidor al registrar un pago)', () => {
  const asPrior = (allocs: { installmentNumber: number; amount: number }[]): Record<number, number> => {
    const m: Record<number, number> = {};
    for (const a of allocs) m[a.installmentNumber] = Math.round(((m[a.installmentNumber] ?? 0) + a.amount) * 100) / 100;
    return m;
  };

  it('repartir sólo el pago nuevo sobre lo ya aplicado da lo mismo que reproducir toda la historia', () => {
    const history = [pay('a', 3000, '2026-11-20T09:00:00Z'), pay('b', 3000, '2026-11-20T10:00:00Z'), pay('c', 9999.99, '2026-11-21T10:00:00Z')];
    const full = allocatePayments({ rows: ROWS, prepaidInstallments: 2, payments: history }).allocations;
    const before = allocatePayments({ rows: ROWS, prepaidInstallments: 2, payments: history.slice(0, 2) }).allocations;
    const next = allocatePayments({ rows: ROWS, prepaidInstallments: 2, priorPaid: asPrior(before), payments: [history[2]!] }).allocations;
    expect([...before, ...next]).toEqual(full);
  });

  it('los dos pagos de 3.000 de la auditoría real: el segundo completa la cuota 1 y deja 791,67 en la 2', () => {
    const first = allocatePayments({ rows: ROWS, payments: [pay('a', 3000, '2026-11-20T21:23:00Z')] }).allocations;
    expect(first).toEqual([{ paymentId: 'a', installmentNumber: 1, amount: 3000 }]);
    const second = allocatePayments({ rows: ROWS, priorPaid: asPrior(first), payments: [pay('b', 3000, '2026-11-20T21:26:00Z')] }).allocations;
    expect(second).toEqual([
      { paymentId: 'b', installmentNumber: 1, amount: 2208.33 },
      { paymentId: 'b', installmentNumber: 2, amount: 791.67 },
    ]);
    const plan = buildUpdatedPlan({ rows: ROWS, allocations: [...first, ...second], asOf: TODAY });
    expect(plan.situation).toBe('CURRENT');
    expect(plan.balance).toBe(119000);
    expect(plan.nextPayment).toEqual({ number: 2, dueDate: '2026-12-19', amount: 4416.66, overdue: false });
  });

  it('lo pagado antes de existir las aplicaciones (cronograma heredado) cuenta como cobertura previa, no como pago de Kobrax', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, priorPaid: { 1: 5208.33, 2: 1000 }, allocations: [], asOf: new Date('2027-01-05T00:00:00Z') });
    expect(plan.rows[0]).toMatchObject({ status: 'PAID', prepaid: true });
    expect(plan.rows[1]).toMatchObject({ paid: 1000, pending: 4208.33, prepaid: true });
    expect(plan.prepaidAmount).toBe(6208.33);
    expect(plan.collectedAmount).toBe(0);
    expect(plan.overdueAmount).toBe(4208.33); // la cuota 2 venció el 19/12
  });
});

describe('desglose desde lo PERSISTIDO', () => {
  it('con aplicaciones guardadas el desglose sale de ellas, no de reproducir: un pago retrofechado no reescribe el anterior', () => {
    // Lo guardado: «a» se aplicó a la cuota 1 completa; «b» (registrado después) a la 2.
    const payments = [pay('a', 5208.33, '2026-11-20T09:00:00Z'), pay('b', 1000, '2026-11-21T09:00:00Z')];
    const allocations = [
      { paymentId: 'a', installmentNumber: 1, amount: 5208.33 },
      { paymentId: 'b', installmentNumber: 2, amount: 1000 },
    ];
    const plan = buildUpdatedPlan({ rows: ROWS, payments, allocations, asOf: TODAY });
    expect(plan.payments.map((b) => [b.paymentId, b.applied, b.balanceAfter])).toEqual([
      ['a', 5208.33, 119791.67],
      ['b', 1000, 118791.67],
    ]);
    expect(plan.payments[1]!.allocations).toEqual([{ installmentNumber: 2, amount: 1000, coversInstallment: false }]);
  });

  it('un pago sin imputación guardada (anterior a la tabla) se marca `unrecorded` y no se inventa un reparto ni cuenta como no aplicado', () => {
    const plan = buildUpdatedPlan({
      rows: ROWS,
      payments: [pay('viejo', 3000, '2026-11-19T09:00:00Z'), pay('nuevo', 500, '2026-11-20T09:00:00Z')],
      allocations: [{ paymentId: 'nuevo', installmentNumber: 1, amount: 500 }],
      asOf: TODAY,
    });
    expect(plan.payments[0]).toMatchObject({ paymentId: 'viejo', applied: 0, unapplied: 0, unrecorded: true, allocations: [] });
    expect(plan.payments[1]).toMatchObject({ paymentId: 'nuevo', applied: 500 });
    expect(plan.unappliedAmount).toBe(0);
  });
});

describe('overdueAmountFromBalance — el vencido de las listas, sin cargar los pagos', () => {
  const seq = (seed: number): (() => number) => {
    let s = seed;
    return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  };

  it('🔴 coincide SIEMPRE con el vencido del plan actualizado completo (barrido de 300 secuencias de pagos)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = seq(seed);
      const payments = Array.from({ length: Math.floor(rnd() * 7) }, (_, i) =>
        pay(`p${i}`, Math.round(rnd() * 25000 * 100) / 100 + 0.01, new Date(Date.UTC(2026, 10, 1 + i, 9)).toISOString()),
      );
      const prepaid = Math.floor(rnd() * 4);
      const asOf = new Date(Date.UTC(2026, 10 + Math.floor(rnd() * 14), 1 + Math.floor(rnd() * 27)));
      const plan = buildUpdatedPlan({ rows: ROWS, prepaidInstallments: prepaid, payments, asOf });
      // El saldo del crédito = lo que falta del plan (total − prepago − lo aplicado).
      const viaBalance = overdueAmountFromBalance({ rows: ROWS, balance: plan.balance, asOf });
      expect(viaBalance).toBe(plan.overdueAmount);
    }
  });

  it('el caso real: sin pagar, la cuota 1 vencida; tras 6.000, nada vencido', () => {
    expect(overdueAmountFromBalance({ rows: ROWS, balance: 125000, asOf: TODAY })).toBe(5208.33);
    expect(overdueAmountFromBalance({ rows: ROWS, balance: 119000, asOf: TODAY })).toBe(0);
    expect(overdueAmountFromBalance({ rows: ROWS, balance: 122000, asOf: TODAY })).toBe(2208.33);
  });
});

describe('mora por CUOTA: días de cada cuota y capital vencido separado del interés', () => {
  // El plan real trae capital e interés por cuota; se pasan al plan para poder partir lo vencido.
  const WITH_SPLIT: PlanScheduleRow[] = CREDIT.schedule!.map((r) => ({ number: r.number, dueDate: r.dueDate, amount: r.amount, principal: r.principal, interest: r.interest }));
  const asOf = new Date('2027-01-20T12:00:00Z'); // vencidas las cuotas 1 (19/11), 2 (19/12) y 3 (19/01)

  it('cada cuota vencida lleva SUS días (no los de la más antigua) y las no vencidas, 0', () => {
    const plan = buildUpdatedPlan({ rows: WITH_SPLIT, asOf });
    expect(plan.rows.slice(0, 4).map((r) => [r.number, r.daysPastDue])).toEqual([[1, 62], [2, 32], [3, 1], [4, 0]]);
    expect(plan.baseDaysPastDue).toBe(62);
  });

  it('una cuota pagada deja de contar días', () => {
    const plan = buildUpdatedPlan({ rows: WITH_SPLIT, payments: [pay('p', 5208.33, '2027-01-10T10:00:00Z')], asOf });
    expect(plan.rows[0]).toMatchObject({ status: 'PAID', daysPastDue: 0 });
    expect(plan.rows[1]!.daysPastDue).toBe(32);
  });

  it('🔴 lo vencido se parte en capital e interés corriente, y suma exactamente lo vencido', () => {
    const plan = buildUpdatedPlan({ rows: WITH_SPLIT, asOf });
    const r1 = plan.rows[0]!;
    expect(r1.interestPending! + r1.principalPending!).toBeCloseTo(r1.pending, 2);
    expect(Math.round((plan.overduePrincipal! + plan.overdueInterest!) * 100)).toBe(Math.round(plan.overdueAmount * 100));
  });

  it('un pago cubre primero el INTERÉS de la cuota y después el capital', () => {
    const interest1 = WITH_SPLIT[0]!.interest!;
    const plan = buildUpdatedPlan({ rows: WITH_SPLIT, payments: [pay('p', interest1, '2027-01-10T10:00:00Z')], asOf });
    expect(plan.rows[0]!.interestPending).toBe(0);
    expect(plan.rows[0]!.principalPending).toBe(WITH_SPLIT[0]!.principal);
  });

  it('sin la partición en las cuotas no se inventa: los campos quedan ausentes', () => {
    const plan = buildUpdatedPlan({ rows: ROWS, asOf });
    expect(plan.rows[0]).not.toHaveProperty('principalPending');
    expect(plan).not.toHaveProperty('overduePrincipal');
    expect(plan.rows[0]!.daysPastDue).toBe(62);
  });
});

