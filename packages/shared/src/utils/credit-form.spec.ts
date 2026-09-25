import { describe, expect, it } from 'vitest';
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  PaymentFrequency,
  RepaymentForm,
} from '../enums/credit.enum.js';
import { buildNewCreditPayload, creditFormState, creditFormTerms, initialCreditForm, type CreditForm } from './credit-form.js';
import { resolveCreditTerms } from './credit-engine.js';

const form = (over: Partial<CreditForm>): CreditForm => ({ ...initialCreditForm('2026-10-25'), ...over });

describe('creditFormState — qué falta, qué avisa y si se guarda', () => {
  it('vacío: falta lo de la definición y no se grita ningún error del motor', () => {
    const s = creditFormState(initialCreditForm('2026-10-25'));
    expect(s.missing).toEqual(['principal', 'ratePercent', 'installmentsCount']);
    expect(s.issues).toEqual([]);
    expect(s.canSubmit).toBe(false);
  });

  it('calculado completo: cotiza y se puede guardar', () => {
    const s = creditFormState(form({ principal: '1000', ratePercent: '10', installmentsCount: '5' }));
    expect(s.missing).toEqual([]);
    expect(s.calculation.quote).toMatchObject({ installment: 300, total: 1500, profit: 500 });
    expect(s.calculation.schedule).toHaveLength(5);
    expect(s.canSubmit).toBe(true);
  });

  it('interés vacío en calculado es un faltante, no un 0 % inventado', () => {
    expect(creditFormState(form({ principal: '1000', installmentsCount: '5' })).missing).toEqual(['ratePercent']);
  });

  it('completo pero inválido: ahí sí aparecen los errores del motor', () => {
    const s = creditFormState(form({ principal: '1000', ratePercent: '150', installmentsCount: '5' }));
    expect(s.issues.map((i) => i.code)).toEqual(['RATE_OUT_OF_RANGE']);
    expect(s.canSubmit).toBe(false);
  });

  it('cuota acordada sin número de cuotas: préstamo abierto, se guarda', () => {
    const s = creditFormState(form({ definition: CreditDefinition.AGREED_INSTALLMENT, principal: '1000', installmentAmount: '50' }));
    expect(s.missing).toEqual([]);
    expect(s.calculation.quote).toMatchObject({ installment: 50, total: null });
    expect(s.calculation.schedule).toBeNull();
    expect(s.canSubmit).toBe(true);
  });

  it('total acordado en cuotas exige el número; en pago único, no', () => {
    const inst = form({ definition: CreditDefinition.AGREED_TOTAL, principal: '1000', agreedTotal: '1500', repayment: RepaymentForm.INSTALLMENTS });
    expect(creditFormState(inst).missing).toEqual(['installmentsCount']);
    const single = form({ definition: CreditDefinition.AGREED_TOTAL, principal: '1000', agreedTotal: '1500', repayment: RepaymentForm.SINGLE });
    expect(creditFormState(single).canSubmit).toBe(true);
  });

  it('capital fijo: hay vista previa pero todavía no se guarda (Fase 6)', () => {
    const s = creditFormState(
      form({ principal: '1200', ratePercent: '1', installmentsCount: '3', amortization: AmortizationMethod.FIXED_PRINCIPAL }),
    );
    expect(s.calculation.schedule).toHaveLength(3);
    expect(s.canSubmit).toBe(false);
  });

  it('cobrar menos de lo prestado avisa pero se guarda', () => {
    const s = creditFormState(
      form({ definition: CreditDefinition.AGREED_INSTALLMENT, principal: '1000', installmentAmount: '275', installmentsCount: '3' }),
    );
    expect(s.issues.map((i) => i.code)).toEqual(['TOTAL_BELOW_PRINCIPAL']);
    expect(s.canSubmit).toBe(true);
  });
});

describe('creditFormTerms — pantalla → condiciones', () => {
  it('la base "% del total" sólo viaja con simple + cuota fija (D8)', () => {
    const simple = creditFormTerms(form({ rateBase: InterestBase.TOTAL }));
    expect(simple).toMatchObject({ rateBase: InterestBase.TOTAL });
    const compound = creditFormTerms(form({ rateBase: InterestBase.TOTAL, interestType: InterestType.COMPOUND }));
    expect('rateBase' in compound).toBe(false);
  });

  it('total acordado en pago único no lleva ni número ni frecuencia', () => {
    const t = creditFormTerms(form({ definition: CreditDefinition.AGREED_TOTAL, principal: '1000', agreedTotal: '1500', installmentsCount: '4' }));
    expect(t).toEqual({ definition: 'agreed_total', principal: 1000, agreedTotal: 1500, repayment: 'single', firstDueDate: '2026-10-25' });
  });
});

/**
 * 🔴 Lo que se manda tiene que pasar la regla D14 de la API **por construcción**: los campos sueltos
 * se derivan de las condiciones con la misma función que usa el servidor.
 */
describe('buildNewCreditPayload', () => {
  const cases: [string, Partial<CreditForm>][] = [
    ['calculado', { principal: '1000', ratePercent: '10', installmentsCount: '3' }],
    ['compuesto', { principal: '10000', ratePercent: '1', installmentsCount: '12', interestType: InterestType.COMPOUND }],
    ['cuota acordada', { definition: CreditDefinition.AGREED_INSTALLMENT, principal: '1000', installmentAmount: '115', installmentsCount: '10' }],
    ['abierto', { definition: CreditDefinition.AGREED_INSTALLMENT, principal: '1000', installmentAmount: '50', frequency: PaymentFrequency.WEEKLY }],
    ['total en cuotas', { definition: CreditDefinition.AGREED_TOTAL, principal: '1000', agreedTotal: '1500', repayment: RepaymentForm.INSTALLMENTS, installmentsCount: '2' }],
    ['total único', { definition: CreditDefinition.AGREED_TOTAL, principal: '1000', agreedTotal: '1500' }],
  ];

  for (const [name, over] of cases) {
    it(`${name}: la API lo aceptaría tal cual`, () => {
      const p = buildNewCreditPayload(form({ ...over, notes: '  nota  ' }), 'client-1')!;
      expect(p).not.toBeNull();
      expect(p.notes).toBe('nota');
      const r = resolveCreditTerms(p.terms!, {
        principalAmount: p.principalAmount,
        installmentAmount: p.installmentAmount,
        installmentsCount: p.installmentsCount,
        frequency: p.frequency,
        nextDueDate: p.nextDueDate,
        interestRate: p.interestRate,
      });
      expect(r.ok).toBe(true);
    });
  }

  it('abierto: no manda número de cuotas', () => {
    const p = buildNewCreditPayload(form(cases[3]![1]), 'client-1')!;
    expect(p.installmentsCount).toBeUndefined();
  });

  it('incompleto o inválido: no hay payload', () => {
    expect(buildNewCreditPayload(initialCreditForm('2026-10-25'), 'client-1')).toBeNull();
    expect(buildNewCreditPayload(form({ principal: '1000', ratePercent: '150', installmentsCount: '5' }), 'client-1')).toBeNull();
  });
});
