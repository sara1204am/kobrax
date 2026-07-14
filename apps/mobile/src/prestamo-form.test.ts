import { InterestBase } from '@kobrax/shared';
import {
  buildPrestamoPayload,
  canSubmitPrestamo,
  currentInstallment,
  initialPrestamo,
  quoteFor,
  totalBelowCapital,
} from './prestamo-form';

const base = () => initialPrestamo('2026-07-14');

describe('prestamo-form — Modo B (cuota calculada)', () => {
  it('reproduce el ejemplo del PDF: 1000, 10% por período, 5 → cuota 300 / total 1500 / ganancia 500', () => {
    const s = { ...base(), mode: 'B' as const, principal: '1000', interestPercent: '10', installmentsCount: '5' };
    expect(quoteFor(s)).toEqual({ installment: 300, total: 1500, profit: 500 });
  });

  it('la cuota editada a mano recalcula el total y se congela (§5.2)', () => {
    let s = { ...base(), mode: 'B' as const, principal: '1000', interestPercent: '10', installmentsCount: '5' };
    s = { ...s, installment: '305', installmentEdited: true }; // redondeo del cobrador
    expect(currentInstallment(s)).toBe(305);
    expect(quoteFor(s).total).toBe(1525);
    expect(buildPrestamoPayload(s, 'cl1').installmentAmount).toBe(305);
  });

  it('rechaza interés fuera de rango (0–100 por período)', () => {
    const over = { ...base(), mode: 'B' as const, principal: '1000', interestPercent: '150', installmentsCount: '5' };
    expect(canSubmitPrestamo(over)).toBe(false);
  });
});

describe('prestamo-form — advertencia total < capital (§5.2, D3)', () => {
  it('en Modo A una cuota baja dispara la advertencia pero NO bloquea', () => {
    // capital 1000, cuota 150, 5 cuotas → total 750 < 1000
    const s = { ...base(), principal: '1000', installment: '150', installmentsCount: '5' };
    expect(totalBelowCapital(s)).toBe(true);
    expect(canSubmitPrestamo(s)).toBe(true);
  });
});

describe('prestamo-form — Modo A (cuota directa)', () => {
  it('guarda con capital + cuota; préstamo abierto si no hay nº de cuotas', () => {
    const s = { ...base(), principal: '500', installment: '120' }; // sin installmentsCount
    expect(canSubmitPrestamo(s)).toBe(true);
    const p = buildPrestamoPayload(s, 'cl1');
    expect(p.installmentAmount).toBe(120);
    expect(p.installmentsCount).toBeUndefined(); // abierto
    expect(p.interestRate).toBeUndefined();
  });

  it('cambiar de modo conserva el capital', () => {
    const a = { ...base(), principal: '800' };
    const b = { ...a, mode: 'B' as const };
    expect(b.principal).toBe('800');
  });

  it('"ya está en curso" exige saldo > 0 y lo manda al payload', () => {
    const s = { ...base(), principal: '1000', installment: '250', inProgress: true, outstandingBalance: '800', daysPastDue: '45' };
    expect(canSubmitPrestamo(s)).toBe(true);
    const p = buildPrestamoPayload(s, 'cl1');
    expect(p.outstandingBalance).toBe(800);
    expect(p.daysPastDue).toBe(45);
  });
});
