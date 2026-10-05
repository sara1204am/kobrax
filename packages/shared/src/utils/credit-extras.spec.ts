import { describe, expect, it } from 'vitest';
import {
  AmortizationMethod,
  ChargeTiming,
  CreditDefinition,
  InterestType,
  PaymentFrequency,
  RatePeriod,
  TermUnit,
} from '../enums/credit.enum.js';
import { calculateCredit, parseCreditTerms, resolveCreditTerms, type CalculatedTerms } from './credit-engine.js';
import { creditFormFromCredit } from './credit-edit.js';
import { chargeFromForm, creditFormState, creditFormTerms, initialCreditForm, type CreditForm } from './credit-form.js';

/**
 * 🔴 F4/06 · D18 — desgravamen y otros cargos. El desgravamen es un % mensual sobre el saldo de capital
 * de cada período; los cargos, por cuota, en la primera cuota (fijo o % del monto) o descontados del
 * desembolso. Todo lo que va en las cuotas lo debe el cliente: entra en el total y en el saldo.
 */
const BANK: CalculatedTerms = {
  definition: CreditDefinition.CALCULATED,
  principal: 10000,
  ratePercent: 18,
  ratePeriod: RatePeriod.ANNUAL,
  interestType: InterestType.COMPOUND,
  amortization: AmortizationMethod.FIXED_INSTALLMENT,
  periods: 12,
  frequency: PaymentFrequency.MONTHLY,
  firstDueDate: '2026-10-31',
};

const WITH_EXTRAS: CalculatedTerms = {
  ...BANK,
  insuranceMonthlyPercent: 0.05,
  charges: [
    { label: 'Gastos de cobranza', timing: ChargeTiming.PER_INSTALLMENT, amount: 5 },
    { label: 'Comisión de apertura', timing: ChargeTiming.FIRST_INSTALLMENT, percent: 1 },
    { label: 'Trámite', timing: ChargeTiming.DEDUCTED, amount: 100 },
  ],
};

describe('calculateCredit con desgravamen y cargos', () => {
  const c = calculateCredit(WITH_EXTRAS);

  it('el desgravamen corre sobre el saldo al inicio de cada período y baja con él', () => {
    expect(c.ok).toBe(true);
    const [r1, r2] = c.schedule!;
    expect(r1).toMatchObject({ principal: 766.8, interest: 150, insurance: 5, charges: 105, amount: 1026.8 });
    // Saldo 9.233,20 × 0,05 % = 4,62; ya sin la comisión de la primera.
    expect(r2).toMatchObject({ insurance: 4.62, charges: 5, amount: 926.42 });
    expect(c.quote?.installmentVaries).toBe(true);
  });

  it('el total incluye seguro y cargos; la ganancia sigue siendo sólo el interés', () => {
    const base = calculateCredit(BANK).quote!;
    const q = c.quote!;
    expect(q.profit).toBe(base.profit);
    const insurance = c.schedule!.reduce((s, r) => s + (r.insurance ?? 0) * 100, 0) / 100;
    expect(q.extras).toEqual({ insuranceTotal: insurance, chargesTotal: 160, deducted: 100, netDisbursement: 9900 });
    expect(q.total).toBeCloseTo(base.total! + insurance + 160, 2);
  });

  it('sin seguro ni cargos: nada cambia (ni filas ni cotización)', () => {
    const plain = calculateCredit({ ...BANK, insuranceMonthlyPercent: 0, charges: [] });
    expect(plain.quote).toEqual(calculateCredit(BANK).quote);
    expect(plain.schedule?.[0]).not.toHaveProperty('insurance');
  });

  it('con otra frecuencia el desgravamen mensual se prorratea (semanal: × 12/52)', () => {
    const w = calculateCredit({ ...WITH_EXTRAS, charges: [], frequency: PaymentFrequency.WEEKLY, periods: 52 });
    expect(w.schedule![0]!.insurance).toBe(1.15); // 10.000 × 0,05 % × 12/52 = 1,1538
  });

  it('lo que no cierra se rechaza', () => {
    const codes = (t: CalculatedTerms) => calculateCredit(t).issues.map((i) => i.code);
    expect(codes({ ...BANK, insuranceMonthlyPercent: -1 })).toContain('INSURANCE_INVALID');
    expect(codes({ ...BANK, insuranceMonthlyPercent: 6 })).toContain('INSURANCE_INVALID');
    expect(codes({ ...BANK, charges: [{ timing: ChargeTiming.PER_INSTALLMENT, percent: 1 }] })).toContain('CHARGE_INVALID');
    expect(codes({ ...BANK, charges: [{ timing: ChargeTiming.FIRST_INSTALLMENT, amount: 5, percent: 1 }] })).toContain('CHARGE_INVALID');
    expect(codes({ ...BANK, charges: [{ timing: ChargeTiming.FIRST_INSTALLMENT, amount: Number.NaN }] })).toContain('CHARGE_INVALID');
    expect(codes({ ...BANK, charges: [{ timing: ChargeTiming.DEDUCTED, percent: 100 }] })).toContain('DEDUCTION_TOO_LARGE');
  });

  it('resolveCreditTerms lo guarda con su cronograma (las cuotas varían)', () => {
    const r = resolveCreditTerms(WITH_EXTRAS, { principalAmount: 10000 });
    expect(r.ok && r.schedule?.length).toBe(12);
    expect(r.ok && r.totalToCollect).toBe(c.quote!.total);
  });
});

describe('parseCreditTerms y el formulario (D18)', () => {
  it('conserva seguro y cargos; sin ellos no agrega claves', () => {
    expect(parseCreditTerms(WITH_EXTRAS)).toEqual(WITH_EXTRAS);
    const plain = parseCreditTerms({ ...BANK, insuranceMonthlyPercent: 0, charges: [] });
    expect(plain && 'insuranceMonthlyPercent' in plain).toBe(false);
    expect(plain && 'charges' in plain).toBe(false);
    expect(parseCreditTerms({ ...BANK, charges: [{ timing: 'monthly' }] })).toBeNull();
    expect(parseCreditTerms({ ...BANK, charges: 'x' })).toBeNull();
  });

  it('pantalla ↔ condiciones, ida y vuelta', () => {
    const f: CreditForm = {
      ...initialCreditForm('2026-10-31'),
      principal: '10000',
      ratePercent: '18',
      interestType: InterestType.COMPOUND,
      installmentsCount: '1',
      termUnit: TermUnit.YEARS,
      insuranceMonthlyPercent: '0.05',
      charges: [
        { id: 'a', label: 'Gastos de cobranza', kind: 'per_installment', value: '5' },
        { id: 'b', label: 'Comisión de apertura', kind: 'first_percent', value: '1' },
        { id: 'c', label: 'Trámite', kind: 'deducted_amount', value: '100' },
      ],
    };
    expect(creditFormTerms(f)).toEqual(WITH_EXTRAS);
    expect(creditFormState(f).canSubmit).toBe(true);
    const back = creditFormFromCredit({ id: 'x', principalAmount: 10000, interestRate: 18, currency: 'BOB', outstandingBalance: 0, terms: WITH_EXTRAS }, '2026-01-01');
    expect(creditFormTerms(back)).toEqual(WITH_EXTRAS);
  });

  it('un cargo con el valor vacío no se inventa en 0: el motor lo rechaza', () => {
    expect(chargeFromForm({ id: 'a', label: '', kind: 'first_amount', value: '' }).amount).toBeNaN();
  });
});
