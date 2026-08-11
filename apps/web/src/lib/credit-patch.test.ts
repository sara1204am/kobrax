import { describe, it, expect } from 'vitest';
import { PaymentFrequency, type CreditDetail } from '@kobrax/shared';
import { creditPatch, hasCreditChanges, type CreditForm } from './credit-patch';

const CREDIT: CreditDetail = {
  id: 'cr-1',
  principalAmount: 3000,
  interestRate: 0,
  currency: 'BOB',
  outstandingBalance: 1800,
  installmentAmount: 300,
  frequency: PaymentFrequency.MONTHLY,
  nextDueDate: '2026-09-15',
  notes: 'Cobrar en el puesto',
};

const formOf = (over: Partial<CreditForm> = {}): CreditForm => ({
  installmentAmount: '300',
  frequency: PaymentFrequency.MONTHLY,
  nextDueDate: '2026-09-15',
  notes: 'Cobrar en el puesto',
  ...over,
});

describe('creditPatch', () => {
  it('sin tocar nada no manda nada', () => {
    const patch = creditPatch(CREDIT, formOf());
    expect(patch).toEqual({});
    expect(hasCreditChanges(patch)).toBe(false);
  });

  it('manda el campo tocado y NADA más', () => {
    expect(creditPatch(CREDIT, formOf({ installmentAmount: '350' }))).toEqual({ installmentAmount: 350 });
    expect(creditPatch(CREDIT, formOf({ nextDueDate: '2026-10-15' }))).toEqual({ nextDueDate: '2026-10-15' });
  });

  /**
   * El borde que decide solo: la cuota es plata congelada —es cómo se cobra este crédito—, no un
   * campo opcional. Un input en blanco es alguien que lo limpió para reescribirlo, no alguien
   * pidiendo que el préstamo deje de tener cuota.
   */
  it('vaciar la cuota NO la borra', () => {
    expect(creditPatch(CREDIT, formOf({ installmentAmount: '' }))).toEqual({});
    expect(creditPatch(CREDIT, formOf({ installmentAmount: '   ' }))).toEqual({});
  });

  it('vaciar la fecha tampoco manda una fecha vacía, que la API rechazaría', () => {
    expect(creditPatch(CREDIT, formOf({ nextDueDate: '' }))).toEqual({});
  });

  // Una nota SÍ se puede vaciar: es texto, no plata.
  it('vaciar la nota sí viaja', () => {
    expect(creditPatch(CREDIT, formOf({ notes: '' }))).toEqual({ notes: '' });
  });

  it('un texto que no es número no viaja como cero', () => {
    expect(creditPatch(CREDIT, formOf({ installmentAmount: 'trescientos' }))).toEqual({});
  });

  it('poner cuota donde no había la manda', () => {
    const sinCuota = { ...CREDIT, installmentAmount: undefined };
    expect(creditPatch(sinCuota, formOf({ installmentAmount: '300' }))).toEqual({ installmentAmount: 300 });
  });
});
