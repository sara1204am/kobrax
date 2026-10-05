import { describe, expect, it } from 'vitest';
import { ArrearsMethod, CreditDefinition, PaymentFrequency } from '../enums/credit.enum.js';
import { arrearsByMethod, oldestUnpaid } from './arrears-method.js';
import { paymentProgress } from './credit-balance.js';
import { priorPaidAmountOf } from './credit-edit.js';
import type { CreditTerms } from './credit-engine.js';

const TODAY = new Date('2026-05-20T12:00:00Z');

/**
 * 🔴 F4/06 · D20 — el ejemplo que se acordó: cuotas 4 (12 abr) y 5 (12 may) impagas, hoy 20 may.
 * Paga la 4: el método de siempre baja a la 5; el bancario sigue contando desde el 12 abr.
 */
describe('arrearsByMethod', () => {
  it('antes del pago, los dos métodos dan 38 días', () => {
    for (const method of [ArrearsMethod.OLDEST_UNPAID, ArrearsMethod.FIRST_DEFAULT]) {
      expect(arrearsByMethod({ method, oldestUnpaidDue: '2026-04-12', balance: 900, asOf: TODAY }).daysPastDue).toBe(38);
    }
  });

  it('el bancario guarda el primer atraso', () => {
    expect(arrearsByMethod({ method: ArrearsMethod.FIRST_DEFAULT, oldestUnpaidDue: '2026-04-12', balance: 900, asOf: TODAY })).toEqual({
      daysPastDue: 38,
      arrearsSince: '2026-04-12',
    });
  });

  it('pagada la 4: el de siempre baja a 8 días; el bancario sigue en 38', () => {
    expect(arrearsByMethod({ method: ArrearsMethod.OLDEST_UNPAID, oldestUnpaidDue: '2026-05-12', balance: 600, asOf: TODAY })).toEqual({
      daysPastDue: 8,
      arrearsSince: undefined,
    });
    expect(
      arrearsByMethod({ method: ArrearsMethod.FIRST_DEFAULT, oldestUnpaidDue: '2026-05-12', arrearsSince: '2026-04-12', balance: 600, asOf: TODAY }),
    ).toEqual({ daysPastDue: 38, arrearsSince: '2026-04-12' });
  });

  it('al quedar al día, el bancario vuelve a 0 y olvida el primer atraso', () => {
    expect(
      arrearsByMethod({ method: ArrearsMethod.FIRST_DEFAULT, oldestUnpaidDue: '2026-06-12', arrearsSince: '2026-04-12', balance: 300, asOf: TODAY }),
    ).toEqual({ daysPastDue: 0, arrearsSince: undefined });
  });

  it('saldado o sin fecha: sin mora', () => {
    expect(arrearsByMethod({ method: ArrearsMethod.FIRST_DEFAULT, oldestUnpaidDue: '2026-04-12', balance: 0, asOf: TODAY }).daysPastDue).toBe(0);
    expect(arrearsByMethod({ oldestUnpaidDue: undefined, balance: 100, asOf: TODAY }).daysPastDue).toBe(0);
  });

  it('sin método: el de siempre', () => {
    expect(arrearsByMethod({ oldestUnpaidDue: '2026-05-12', arrearsSince: '2026-04-12', balance: 600, asOf: TODAY }).daysPastDue).toBe(8);
  });

  it('oldestUnpaid: la impaga de vencimiento más viejo', () => {
    const rows = [
      { number: 1, dueDate: '2026-03-12', status: 'PAID' },
      { number: 2, dueDate: '2026-04-12', status: 'OVERDUE' },
      { number: 3, dueDate: '2026-05-12', status: 'PARTIAL' },
    ];
    expect(oldestUnpaid(rows)?.number).toBe(2);
    expect(oldestUnpaid([{ number: 1, dueDate: '2026-03-12', status: 'PAID' }])).toBeNull();
  });
});

describe('«Recuperado» sólo cuenta lo cobrado en Kobrax (D13)', () => {
  const TERMS: CreditTerms = {
    definition: CreditDefinition.AGREED_INSTALLMENT,
    principal: 1000,
    installmentAmount: 150,
    installmentsCount: 10,
    frequency: PaymentFrequency.MONTHLY,
    firstDueDate: '2026-01-12',
  };

  it('3 cuotas pagadas antes del registro = 450', () => {
    expect(priorPaidAmountOf(TERMS, { paidInstallments: 3, daysPastDue: 0 })).toBe(450);
    expect(priorPaidAmountOf(TERMS, undefined)).toBe(0);
  });

  it('recién registrado arranca en 0 %; pagando una cuota en Kobrax, 1 de 7', () => {
    const base = { basis: 'total' as const, principalAmount: 1000, totalToCollect: 1500, priorPaidAmount: 450 };
    expect(paymentProgress({ ...base, outstandingBalance: 1050 })).toBe(0);
    expect(paymentProgress({ ...base, outstandingBalance: 900 })).toBe(14); // 150 / 1.050
  });
});
