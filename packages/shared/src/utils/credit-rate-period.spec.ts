import { describe, expect, it } from 'vitest';
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  PaymentFrequency,
  RateConvention,
  RatePeriod,
  TermUnit,
} from '../enums/credit.enum.js';
import { calculateCredit, parseCreditTerms, periodicRatePercent, type CalculatedTerms } from './credit-engine.js';
import { creditFormFromCredit } from './credit-edit.js';
import { creditFormState, creditFormTerms, initialCreditForm, installmentsToMonths, termInstallments, type CreditForm } from './credit-form.js';

/**
 * 🔴 F4/06 · D17 — el período de la tasa es independiente de la frecuencia de pago. El banco dice
 * «18 % anual a 3 años» y se paga mensual; el prestamista, «5 % mensual» y cobra semanal.
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

describe('periodicRatePercent — la tasa de cada cuota', () => {
  it('por cuota (o sin período): la misma, como antes', () => {
    expect(periodicRatePercent({ ratePercent: 10, frequency: PaymentFrequency.WEEKLY })).toBe(10);
    expect(periodicRatePercent({ ratePercent: 10, ratePeriod: RatePeriod.PER_INSTALLMENT, frequency: PaymentFrequency.WEEKLY })).toBe(10);
  });

  it('nominal (default): proporcional', () => {
    expect(periodicRatePercent(BANK)).toBeCloseTo(1.5, 10); // 18 % anual, mensual
    expect(periodicRatePercent({ ratePercent: 5, ratePeriod: RatePeriod.MONTHLY, frequency: PaymentFrequency.WEEKLY })).toBeCloseTo((5 * 12) / 52, 10);
    expect(periodicRatePercent({ ratePercent: 10, ratePeriod: RatePeriod.QUARTERLY, frequency: PaymentFrequency.MONTHLY })).toBeCloseTo(10 / 3, 10);
    expect(periodicRatePercent({ ratePercent: 36, ratePeriod: RatePeriod.ANNUAL, frequency: PaymentFrequency.DAILY })).toBeCloseTo(0.1, 10); // año de 360
  });

  it('efectiva: capitaliza', () => {
    const r = periodicRatePercent({ ...BANK, rateConvention: RateConvention.EFFECTIVE });
    expect(r).toBeCloseTo((Math.pow(1.18, 1 / 12) - 1) * 100, 10); // ≈ 1,389 %
  });
});

describe('calculateCredit con tasa anual (préstamo de banco)', () => {
  it('10.000 al 18 % nominal anual, francés mensual a 12 meses: cuota 916,80', () => {
    const c = calculateCredit(BANK);
    expect(c.ok).toBe(true);
    expect(c.quote?.installment).toBe(916.8);
    expect(c.schedule).toHaveLength(12);
    expect(c.schedule?.[11]?.principalBalance).toBe(0);
  });

  it('el tope de 100 % es el de la cuota ya convertida: 120 % anual mensual (10 %) es válido', () => {
    expect(calculateCredit({ ...BANK, ratePercent: 120 }).issues.map((i) => i.code)).not.toContain('RATE_OUT_OF_RANGE');
  });

  it('interés sobre el total no admite período', () => {
    const t: CalculatedTerms = { ...BANK, interestType: InterestType.SIMPLE, rateBase: InterestBase.TOTAL };
    expect(calculateCredit(t).issues.map((i) => i.code)).toContain('RATE_PERIOD_NOT_SUPPORTED');
  });

  it('parseCreditTerms conserva período y convención; el default no se guarda', () => {
    expect(parseCreditTerms({ ...BANK, rateConvention: RateConvention.EFFECTIVE })).toMatchObject({ ratePeriod: 'annual', rateConvention: 'effective' });
    const plain = parseCreditTerms({ ...BANK, ratePeriod: RatePeriod.PER_INSTALLMENT, rateConvention: RateConvention.NOMINAL });
    expect(plain && 'ratePeriod' in plain).toBe(false);
    expect(plain && 'rateConvention' in plain).toBe(false);
    expect(parseCreditTerms({ ...BANK, ratePeriod: 'fortnight' })).toBeNull();
  });
});

describe('plazo en meses o años (D17)', () => {
  it('termInstallments convierte según la frecuencia', () => {
    expect(termInstallments('3', TermUnit.YEARS, PaymentFrequency.MONTHLY)).toBe(36);
    expect(termInstallments('1', TermUnit.YEARS, PaymentFrequency.WEEKLY)).toBe(52);
    expect(termInstallments('6', TermUnit.MONTHS, PaymentFrequency.QUARTERLY)).toBe(2);
    expect(termInstallments('3', TermUnit.MONTHS, PaymentFrequency.WEEKLY)).toBe(13);
    expect(termInstallments('7', TermUnit.INSTALLMENTS, PaymentFrequency.MONTHLY)).toBe(7);
  });

  it('al reabrir un calculado, el período vuelve en años, o en meses, o en cuotas si no cierra', () => {
    expect(installmentsToMonths(13, PaymentFrequency.WEEKLY)).toBe(3);
    expect(installmentsToMonths(10, PaymentFrequency.WEEKLY)).toBeNull();
    const credit = { id: 'c', principalAmount: 10000, interestRate: 18, currency: 'BOB', outstandingBalance: 0 };
    expect(creditFormFromCredit({ ...credit, terms: { ...BANK, periods: 36 } }, '2026-01-01')).toMatchObject({ installmentsCount: '3', termUnit: TermUnit.YEARS });
    expect(creditFormFromCredit({ ...credit, terms: { ...BANK, periods: 18 } }, '2026-01-01')).toMatchObject({ installmentsCount: '18', termUnit: TermUnit.MONTHS });
    const weekly = creditFormFromCredit({ ...credit, terms: { ...BANK, periods: 10, frequency: PaymentFrequency.WEEKLY } }, '2026-01-01');
    expect(weekly).toMatchObject({ installmentsCount: '10', termUnit: TermUnit.INSTALLMENTS });
    expect(creditFormTerms(weekly)).toMatchObject({ periods: 10 });
  });

  it('un plazo que no da cuotas enteras no se redondea: se avisa', () => {
    expect(termInstallments('1', TermUnit.MONTHS, PaymentFrequency.WEEKLY)).toBeNaN();
    const f: CreditForm = { ...initialCreditForm('2026-10-01'), principal: '1000', ratePercent: '5', installmentsCount: '1', termUnit: TermUnit.MONTHS, frequency: PaymentFrequency.WEEKLY };
    const s = creditFormState(f);
    expect(s.issues.map((i) => i.code)).toEqual(['TERM_NOT_WHOLE']);
    expect(s.canSubmit).toBe(false);
  });

  it('el formulario del banco: 18 % anual a 1 año, mensual → las condiciones de arriba', () => {
    const f: CreditForm = {
      ...initialCreditForm('2026-10-31'),
      principal: '10000',
      ratePercent: '18',
      ratePeriod: RatePeriod.ANNUAL,
      interestType: InterestType.COMPOUND,
      installmentsCount: '1',
      termUnit: TermUnit.YEARS,
    };
    expect(creditFormTerms(f)).toEqual(BANK);
    // Y al volver a abrirlo, las mismas condiciones (el plazo queda en cuotas).
    expect(creditFormTerms(creditFormFromCredit({ id: 'c', principalAmount: 10000, interestRate: 18, currency: 'BOB', outstandingBalance: 0, terms: BANK }, '2026-01-01'))).toEqual(BANK);
  });
});
