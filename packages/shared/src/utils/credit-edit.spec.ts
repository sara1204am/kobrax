import { describe, expect, it } from 'vitest';
import { AmortizationMethod, CreditDefinition, InterestType, PaymentFrequency, RepaymentForm } from '../enums/credit.enum.js';
import type { CreditDetail } from '../types/client.types.js';
import {
  creditFormFromCredit,
  hasInitialState,
  initialStateForm,
  initialStateFromForm,
  parseInitialState,
  registeredState,
  termsEditBlock,
} from './credit-edit.js';
import { creditFormTerms } from './credit-form.js';
import type { CreditTerms } from './credit-engine.js';

const AGREED: CreditTerms = {
  definition: CreditDefinition.AGREED_INSTALLMENT,
  principal: 1000,
  installmentAmount: 300,
  installmentsCount: 5,
  frequency: PaymentFrequency.MONTHLY,
  firstDueDate: '2026-01-31',
};

const OPEN: CreditTerms = { ...AGREED, installmentsCount: undefined };

describe('registeredState — D13', () => {
  it('sin estado al registrar es el alta: saldo = total, vence la primera cuota', () => {
    expect(registeredState(AGREED)).toEqual({
      ok: true,
      outstandingBalance: 1500,
      balanceBasis: 'total',
      nextDueDate: '2026-01-31',
      daysPastDue: 0,
      balanceDerived: true,
    });
  });

  it('con cuotas pagadas: descuenta esas cuotas y vence la primera no pagada (fin de mes, D6)', () => {
    const r = registeredState(AGREED, { paidInstallments: 2, daysPastDue: 0 });
    expect(r).toMatchObject({ ok: true, outstandingBalance: 900, nextDueDate: '2026-03-31', balanceDerived: true });
  });

  it('el saldo tipeado manda, con base total', () => {
    const r = registeredState(AGREED, { paidInstallments: 2, outstandingBalance: 850.5, daysPastDue: 12 });
    expect(r).toMatchObject({ ok: true, outstandingBalance: 850.5, balanceBasis: 'total', daysPastDue: 12, balanceDerived: false });
  });

  it('total acordado en cuotas: la última cuota absorbe el redondeo y el saldo cierra al céntimo', () => {
    const terms: CreditTerms = {
      definition: CreditDefinition.AGREED_TOTAL,
      principal: 1000,
      agreedTotal: 1000,
      repayment: RepaymentForm.INSTALLMENTS,
      installmentsCount: 3,
      frequency: PaymentFrequency.MONTHLY,
      firstDueDate: '2026-01-10',
    };
    // 333,33 + 333,33 + 333,34: pagadas dos, queda la última.
    expect(registeredState(terms, { paidInstallments: 2, daysPastDue: 0 })).toMatchObject({ ok: true, outstandingBalance: 333.34 });
  });

  it('préstamo abierto: saldo = capital con base principal (D16); la fecha avanza por la frecuencia', () => {
    expect(registeredState(OPEN, { paidInstallments: 3, daysPastDue: 0 })).toMatchObject({
      ok: true,
      outstandingBalance: 1000,
      balanceBasis: 'principal',
      nextDueDate: '2026-04-30',
    });
  });

  it('rechaza lo que no cierra', () => {
    expect(registeredState(AGREED, { paidInstallments: 5, daysPastDue: 0 })).toEqual({ ok: false, code: 'PAID_INSTALLMENTS_TOO_MANY' });
    expect(registeredState(AGREED, { paidInstallments: 1.5, daysPastDue: 0 })).toEqual({ ok: false, code: 'PAID_INSTALLMENTS_INVALID' });
    expect(registeredState(AGREED, { paidInstallments: 0, outstandingBalance: 1500.01, daysPastDue: 0 })).toEqual({
      ok: false,
      code: 'BALANCE_ABOVE_TOTAL',
    });
    expect(registeredState(AGREED, { paidInstallments: 0, outstandingBalance: 0, daysPastDue: 0 })).toEqual({ ok: false, code: 'BALANCE_INVALID' });
    expect(registeredState(AGREED, { paidInstallments: 0, daysPastDue: -1 })).toEqual({ ok: false, code: 'DAYS_PAST_DUE_INVALID' });
    expect(registeredState({ ...AGREED, principal: 0 })).toEqual({ ok: false, code: 'TERMS_INVALID' });
  });
});

describe('estado al registrar — formulario y metadata', () => {
  it('ida y vuelta del formulario; vacío es 0 y el saldo vacío se deriva', () => {
    const s = { paidInstallments: 2, outstandingBalance: 900, daysPastDue: 10 };
    expect(initialStateFromForm(initialStateForm(s))).toEqual(s);
    expect(initialStateFromForm(initialStateForm())).toEqual({ paidInstallments: 0, daysPastDue: 0 });
  });

  it('un número ilegible no se vuelve 0: pasa como NaN y la regla lo rechaza', () => {
    const s = initialStateFromForm({ paidInstallments: 'x', outstandingBalance: '', daysPastDue: '' });
    expect(registeredState(AGREED, s)).toEqual({ ok: false, code: 'PAID_INSTALLMENTS_INVALID' });
  });

  it('un estado vacío no cuenta como estado', () => {
    expect(hasInitialState({ paidInstallments: 0, daysPastDue: 0 })).toBe(false);
    expect(hasInitialState({ paidInstallments: 0, daysPastDue: 3 })).toBe(true);
  });

  it('parseInitialState descarta formas inválidas', () => {
    expect(parseInitialState({ paidInstallments: 1, daysPastDue: 0 })).toEqual({ paidInstallments: 1, daysPastDue: 0 });
    expect(parseInitialState({ paidInstallments: '1', daysPastDue: 0 })).toBeUndefined();
    expect(parseInitialState(null)).toBeUndefined();
  });
});

const CREDIT: CreditDetail = {
  id: 'cr1',
  principalAmount: 1000,
  interestRate: 0,
  currency: 'BOB',
  outstandingBalance: 1500,
  installmentAmount: 300,
  installmentsCount: 5,
  frequency: PaymentFrequency.WEEKLY,
  nextDueDate: '2026-02-01',
  notes: 'nota',
};

describe('creditFormFromCredit', () => {
  it('con condiciones: vuelve a armar exactamente las mismas', () => {
    const terms: CreditTerms = {
      definition: CreditDefinition.CALCULATED,
      principal: 1000,
      ratePercent: 10,
      interestType: InterestType.SIMPLE,
      amortization: AmortizationMethod.FIXED_INSTALLMENT,
      periods: 5,
      frequency: PaymentFrequency.MONTHLY,
      firstDueDate: '2026-01-31',
    };
    // El formulario manda la base sólo donde aplica; por defecto es por período.
    expect(creditFormTerms(creditFormFromCredit({ ...CREDIT, terms }, '2026-01-01'))).toEqual({ ...terms, rateBase: 'PER_PERIOD' });
    expect(creditFormTerms(creditFormFromCredit({ ...CREDIT, terms: AGREED }, '2026-01-01'))).toEqual(AGREED);
  });

  it('sin condiciones (anterior a F4/06): cuota acordada con la cuota que se cobra', () => {
    const f = creditFormFromCredit(CREDIT, '2026-01-01');
    expect(creditFormTerms(f)).toEqual({ ...AGREED, frequency: PaymentFrequency.WEEKLY, firstDueDate: '2026-02-01' });
    expect(f.notes).toBe('nota');
  });

  it('sin condiciones y abierto: el número de cuotas queda vacío', () => {
    expect(creditFormFromCredit({ ...CREDIT, installmentsCount: 0 }, '2026-01-01').installmentsCount).toBe('');
  });
});

describe('termsEditBlock', () => {
  it('importado, con pagos o con cronograma guardado: no se redefine', () => {
    expect(termsEditBlock({ locked: true })).toBe('locked');
    expect(termsEditBlock({ hasPayments: true })).toBe('payments');
    expect(termsEditBlock({ hasSchedule: true })).toBe('schedule');
    expect(termsEditBlock({})).toBeNull();
  });
});
