import { describe, expect, it } from 'vitest';
import { CreditOrigin } from '../enums/credit.enum.js';
import { creditTotalToCollect, paymentProgress } from './credit-balance.js';
import { balanceBasisOf, readCreditMetadata } from './loan.js';

/**
 * D15: el saldo es el total pendiente. Lo que protege este archivo es que **nunca se suponga** una
 * base para un crédito viejo: la marca sólo existe si alguien la escribió al darlo de alta.
 */
describe('balanceBasisOf — qué representa el saldo', () => {
  it('la marca guardada manda', () => {
    expect(balanceBasisOf(readCreditMetadata({ balanceBasis: 'total' }))).toBe('total');
    expect(balanceBasisOf(readCreditMetadata({ balanceBasis: 'principal' }))).toBe('principal');
  });

  it('importado o API sin marca → total (el archivo trae el saldo total pendiente)', () => {
    expect(balanceBasisOf(readCreditMetadata({ origin: CreditOrigin.IMPORT }))).toBe('total');
    expect(balanceBasisOf(readCreditMetadata({ origin: CreditOrigin.API }))).toBe('total');
  });

  it('manual sin marca → legacy: no se supone nada', () => {
    expect(balanceBasisOf(readCreditMetadata({ origin: CreditOrigin.MANUAL }))).toBe('legacy');
    expect(balanceBasisOf(readCreditMetadata({ origin: CreditOrigin.QUICK_BATCH }))).toBe('legacy');
  });

  it('una marca desconocida se ignora, no se interpreta', () => {
    expect(readCreditMetadata({ balanceBasis: 'capital' }).balanceBasis).toBeUndefined();
  });
});

describe('creditTotalToCollect — el total, si se conoce', () => {
  it('con cronograma: Σ de las cuotas', () => {
    expect(creditTotalToCollect({ principalAmount: 1000, installments: [{ amount: 433.33 }, { amount: 433.33 }, { amount: 433.34 }] })).toBe(1300);
  });

  it('con cuota y número de cuotas: cuota × n', () => {
    expect(creditTotalToCollect({ principalAmount: 1000, installmentAmount: 300, installmentsCount: 5 })).toBe(1500);
  });

  it('préstamo abierto o sin cuota: no se inventa', () => {
    expect(creditTotalToCollect({ principalAmount: 1000, installmentAmount: 50, installmentsCount: 0 })).toBeNull();
    expect(creditTotalToCollect({ principalAmount: 10000, installmentsCount: 1 })).toBeNull();
  });
});

describe('paymentProgress — la barra se mide contra el total por cobrar', () => {
  it('base total: 1.500 por cobrar, quedan 900 → 40 %', () => {
    expect(paymentProgress({ basis: 'total', outstandingBalance: 900, principalAmount: 1000, totalToCollect: 1500 })).toBe(40);
  });

  // Recién dado: saldo = total. Con la regla vieja la barra arrancaba en 0 % también, pero terminaba
  // en 100 % cuando quedaba todo el interés por cobrar.
  it('base total: recién dado → 0 %; cobrado todo → 100 %', () => {
    expect(paymentProgress({ basis: 'total', outstandingBalance: 1500, principalAmount: 1000, totalToCollect: 1500 })).toBe(0);
    expect(paymentProgress({ basis: 'total', outstandingBalance: 0, principalAmount: 1000, totalToCollect: 1500 })).toBe(100);
  });

  it('base total sin total conocido (importado sin cuota): sin barra', () => {
    expect(paymentProgress({ basis: 'total', outstandingBalance: 6000, principalAmount: 10000, totalToCollect: null })).toBeNull();
  });

  it('legacy y préstamo abierto: contra el capital, como siempre', () => {
    expect(paymentProgress({ basis: 'legacy', outstandingBalance: 600, principalAmount: 1000, totalToCollect: 1500 })).toBe(40);
    expect(paymentProgress({ basis: 'principal', outstandingBalance: 250, principalAmount: 1000, totalToCollect: null })).toBe(75);
  });

  it('nunca sale de 0–100', () => {
    expect(paymentProgress({ basis: 'total', outstandingBalance: 2000, principalAmount: 1000, totalToCollect: 1500 })).toBe(0);
    expect(paymentProgress({ basis: 'legacy', outstandingBalance: 0, principalAmount: 0, totalToCollect: null })).toBeNull();
  });
});

describe('metadata.terms — ida y vuelta', () => {
  const terms = {
    definition: 'agreed_total',
    principal: 1000,
    agreedTotal: 1500,
    repayment: 'installments',
    installmentsCount: 2,
    frequency: 'MONTHLY',
    firstDueDate: '2026-10-25',
  };

  it('se lee con su versión y da el total exacto', () => {
    const meta = readCreditMetadata({ origin: 'manual', terms, termsVersion: 1 });
    expect(meta.terms).toEqual(terms);
    expect(meta.termsVersion).toBe(1);
    expect(creditTotalToCollect({ principalAmount: 1000, terms: meta.terms })).toBe(1500);
  });

  // Interpretar mal unas condiciones es peor que no tenerlas.
  it('una versión desconocida o una forma rota no se lee', () => {
    expect(readCreditMetadata({ terms, termsVersion: 2 }).terms).toBeUndefined();
    expect(readCreditMetadata({ terms }).terms).toBeUndefined();
    expect(readCreditMetadata({ terms: { ...terms, repayment: 'x' }, termsVersion: 1 }).terms).toBeUndefined();
  });

  it('con terms de un préstamo abierto, el total sigue siendo desconocido', () => {
    const open = { definition: 'agreed_installment', principal: 1000, installmentAmount: 50, frequency: 'WEEKLY', firstDueDate: '2026-10-25' };
    const meta = readCreditMetadata({ terms: open, termsVersion: 1 });
    expect(creditTotalToCollect({ principalAmount: 1000, installmentAmount: 50, installmentsCount: 0, terms: meta.terms })).toBeNull();
  });
});
