import { describe, expect, it } from 'vitest';
import { suggestedPaymentAmount } from './payment-suggestion.js';

describe('suggestedPaymentAmount — Kobrax', () => {
  it('con cronograma: lo que falta de la cuota impaga más antigua', () => {
    const installments = [
      { number: 1, amount: 300, paidAmount: 300, status: 'PAID' },
      { number: 3, amount: 300, paidAmount: 0, status: 'PENDING' },
      { number: 2, amount: 300, paidAmount: 120, status: 'PARTIAL' },
    ];
    expect(suggestedPaymentAmount({ external: false, outstandingBalance: 900, installments })).toBe(180);
  });

  it('sin cronograma: la cuota congelada, nunca más que el saldo', () => {
    expect(suggestedPaymentAmount({ external: false, outstandingBalance: 900, installmentAmount: 250 })).toBe(250);
    expect(suggestedPaymentAmount({ external: false, outstandingBalance: 100, installmentAmount: 250 })).toBe(100);
  });

  it('sin cuota conocida: vacío', () => {
    expect(suggestedPaymentAmount({ external: false, outstandingBalance: 900 })).toBeUndefined();
    expect(suggestedPaymentAmount({ external: false, outstandingBalance: 0, installmentAmount: 250 })).toBeUndefined();
  });
});

describe('suggestedPaymentAmount — PSF', () => {
  it('el monto en mora reportado', () => {
    expect(suggestedPaymentAmount({ external: true, outstandingBalance: 1996.85, reportedPastDueAmount: 500, installmentAmount: 195.61 })).toBe(500);
  });

  it('sin monto en mora: la cuota reportada', () => {
    expect(suggestedPaymentAmount({ external: true, outstandingBalance: 1996.85, installmentAmount: 195.61 })).toBe(195.61);
    expect(suggestedPaymentAmount({ external: true, outstandingBalance: 1996.85, reportedPastDueAmount: 0, installmentAmount: 195.61 })).toBe(195.61);
  });

  it('nunca el saldo: sin mora ni cuota reportadas, vacío', () => {
    expect(suggestedPaymentAmount({ external: true, outstandingBalance: 1996.85 })).toBeUndefined();
  });
});
