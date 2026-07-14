import { describe, expect, it } from 'vitest';
import { InterestBase, PaymentFrequency, PortfolioStatus, CreditOrigin } from '../enums/credit.enum.js';
import {
  addPeriods,
  arrearsFromDueDate,
  creditView,
  portfolioStatus,
  quoteFromInstallment,
  quoteLoan,
  readCreditMetadata,
} from './loan.js';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('quoteLoan — las dos bases del §4.2', () => {
  it('el ejemplo literal del PDF: 1.000 al 10% por período en 5 cuotas → 300 / 1.500 / 500', () => {
    expect(quoteLoan({ principal: 1000, interestPercent: 10, installments: 5 })).toEqual({
      installment: 300,
      total: 1500,
      profit: 500,
    });
  });

  it('base "% total": 1.000 al 10% total en 5 cuotas → total 1.100, cuota 220', () => {
    expect(quoteLoan({ principal: 1000, interestPercent: 10, installments: 5, base: InterestBase.TOTAL })).toEqual({
      installment: 220,
      total: 1100,
      profit: 100,
    });
  });

  it('interés 0 devuelve capital/n sin ganancia', () => {
    expect(quoteLoan({ principal: 900, interestPercent: 0, installments: 3 })).toEqual({
      installment: 300,
      total: 900,
      profit: 0,
    });
  });

  it('la cuota redondeada a mano recalcula el total (§5.2, es editable)', () => {
    // 1.000 al 7% por período en 3 → 270,00 exacto; el cobrador la sube a 275 y el total la sigue.
    expect(quoteFromInstallment(1000, 275, 3)).toEqual({ installment: 275, total: 825, profit: -175 });
  });
});

describe('addPeriods', () => {
  it('avanza el paso de cada frecuencia', () => {
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.DAILY)).toEqual(d('2026-07-14'));
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.WEEKLY)).toEqual(d('2026-07-20'));
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.BIWEEKLY)).toEqual(d('2026-07-27'));
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.MONTHLY)).toEqual(d('2026-08-13'));
  });

  it('mensual sobre fin de mes no se pasa al mes siguiente', () => {
    expect(addPeriods(d('2026-01-31'), 1, PaymentFrequency.MONTHLY).getUTCMonth()).toBe(2); // marzo (JS clamp)
  });
});

describe('arrearsFromDueDate — mora sin cronograma (§6)', () => {
  it('cuenta los días desde la fecha vencida', () => {
    expect(arrearsFromDueDate('2026-07-01', 500, d('2026-07-13'))).toBe(12);
  });

  it('saldo 0 ⇒ sin mora, aunque la fecha esté vencida', () => {
    expect(arrearsFromDueDate('2026-07-01', 0, d('2026-07-13'))).toBe(0);
  });

  it('fecha futura ⇒ 0, nunca negativo', () => {
    expect(arrearsFromDueDate('2026-08-01', 500, d('2026-07-13'))).toBe(0);
  });

  it('sin fecha ⇒ 0 (no inventa mora)', () => {
    expect(arrearsFromDueDate(undefined, 500, d('2026-07-13'))).toBe(0);
  });
});

describe('portfolioStatus — los 5 estados derivados del §5.3', () => {
  const base = { outstandingBalance: 500, daysPastDue: 0, nextDueDate: '2026-08-01' };

  it('PAGADO gana sobre todo: saldo 0', () => {
    expect(portfolioStatus({ ...base, outstandingBalance: 0, daysPastDue: 30 }, d('2026-07-13'))).toBe(
      PortfolioStatus.PAID,
    );
  });

  it('PROMESA tapa la mora: hay compromiso vigente', () => {
    expect(portfolioStatus({ ...base, daysPastDue: 12, hasActivePromise: true }, d('2026-07-13'))).toBe(
      PortfolioStatus.PROMISE,
    );
  });

  it('EN MORA con daysPastDue > 0', () => {
    expect(portfolioStatus({ ...base, daysPastDue: 12 }, d('2026-07-13'))).toBe(PortfolioStatus.OVERDUE);
  });

  it('POR VENCER dentro del umbral de 3 días', () => {
    expect(portfolioStatus({ ...base, nextDueDate: '2026-07-15' }, d('2026-07-13'))).toBe(PortfolioStatus.DUE_SOON);
  });

  it('AL DÍA más allá del umbral', () => {
    expect(portfolioStatus(base, d('2026-07-13'))).toBe(PortfolioStatus.CURRENT);
  });

  it('fecha ya pasada pero mora aún sin recalcular ⇒ EN MORA igual', () => {
    expect(portfolioStatus({ ...base, nextDueDate: '2026-07-10' }, d('2026-07-13'))).toBe(PortfolioStatus.OVERDUE);
  });
});

describe('creditView — cuota y próxima fecha, vengan de donde vengan', () => {
  it('sin cronograma: las lee del metadata', () => {
    const v = creditView({
      metadata: { frequency: 'WEEKLY', origin: 'import', installmentAmount: 300, nextDueDate: '2026-07-20' },
    });
    expect(v).toMatchObject({
      hasSchedule: false,
      locked: true, // importado ⇒ candado
      installmentAmount: 300,
      nextDueDate: '2026-07-20',
      frequency: PaymentFrequency.WEEKLY,
    });
  });

  it('con cronograma: las deriva de la cuota impaga más antigua', () => {
    const v = creditView({
      metadata: { origin: 'manual' },
      installments: [
        { dueDate: d('2026-06-01'), amount: 250, status: 'PAID' },
        { dueDate: d('2026-07-01'), amount: 250, status: 'PENDING' },
        { dueDate: d('2026-08-01'), amount: 250, status: 'PENDING' },
      ],
    });
    expect(v).toMatchObject({ hasSchedule: true, locked: false, installmentAmount: 250, nextDueDate: '2026-07-01' });
  });

  it('solo el dato de un core ajeno lleva candado (§3): import y api sí, manual y quick_batch no', () => {
    expect(creditView({ metadata: { origin: 'manual' } }).locked).toBe(false);
    expect(creditView({ metadata: { origin: 'quick_batch' } }).locked).toBe(false); // lote propio del cobrador
    expect(creditView({ metadata: { origin: 'import' } }).locked).toBe(true);
    expect(creditView({ metadata: { origin: 'api' } }).locked).toBe(true);
  });
});

describe('readCreditMetadata', () => {
  it('un metadata vacío no rompe: mensual y manual por defecto', () => {
    expect(readCreditMetadata({})).toEqual({
      frequency: PaymentFrequency.MONTHLY,
      origin: CreditOrigin.MANUAL,
      installmentAmount: undefined,
      nextDueDate: undefined,
      externalRef: undefined,
      notes: undefined,
    });
  });

  it('descarta valores basura en vez de propagarlos', () => {
    const m = readCreditMetadata({ frequency: 'ANUAL', origin: 42, installmentAmount: '300' });
    expect(m.frequency).toBe(PaymentFrequency.MONTHLY);
    expect(m.origin).toBe(CreditOrigin.MANUAL);
    expect(m.installmentAmount).toBeUndefined();
  });
});
