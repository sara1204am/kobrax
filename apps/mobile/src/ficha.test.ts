import type { CaseActivityItem } from './cases.service';
import type { PaymentItem } from './payments.service';
import { buildTimeline, promiseReady, recovery } from './ficha';

const act = (p: Partial<CaseActivityItem>): CaseActivityItem => ({ id: 'a', type: 'CALL', createdAt: '2026-07-01T10:00:00Z', ...p });
const pay = (p: Partial<PaymentItem>): PaymentItem =>
  ({ id: 'p', creditId: 'cr', amount: 100, method: 'CASH' as never, paymentDate: '2026-07-02T10:00:00Z', createdAt: '2026-07-02T10:00:00Z', ...p });

describe('buildTimeline', () => {
  it('intercala pagos y gestiones por fecha desc y marca el tipo', () => {
    const t = buildTimeline(
      [act({ id: 'a1', createdAt: '2026-07-01T10:00:00Z' }), act({ id: 'a2', createdAt: '2026-07-03T10:00:00Z' })],
      [pay({ id: 'p1', paymentDate: '2026-07-02T10:00:00Z' })],
    );
    expect(t.map((e) => `${e.kind}:${e.id}`)).toEqual(['activity:a2', 'payment:p1', 'activity:a1']);
    expect(t[1]).toMatchObject({ kind: 'payment', amount: 100, method: 'CASH' });
  });
});

describe('recovery — «Recuperado X de Y» (D15)', () => {
  it('base total: contra el total por cobrar, no contra el capital', () => {
    // 1.000 al 10 % en 5 cuotas de 300: debe 1.500 y ya pagó 400.
    expect(recovery({ balanceBasis: 'total', outstandingBalance: 1100, principalAmount: 1000, totalToCollect: 1500 })).toEqual({
      recovered: 400,
      of: 1500,
      percent: 27,
    });
  });

  it('base total sin total conocido: no hay barra', () => {
    expect(recovery({ balanceBasis: 'total', outstandingBalance: 800, principalAmount: 1000, totalToCollect: null })).toBeNull();
  });

  it('legacy y principal: contra el capital, clampado a [0, capital]', () => {
    expect(recovery({ balanceBasis: 'legacy', outstandingBalance: 400, principalAmount: 1000 })).toEqual({ recovered: 600, of: 1000, percent: 60 });
    expect(recovery({ outstandingBalance: 1200, principalAmount: 1000 })).toEqual({ recovered: 0, of: 1000, percent: 0 });
  });

  it('cargado con cuotas ya pagadas (D13): sólo cuenta lo cobrado en Kobrax', () => {
    // Total 1.500, 3 cuotas de 150 pagadas antes (450): al registrarlo debe 1.050; cobró 150 en Kobrax.
    expect(recovery({ balanceBasis: 'total', outstandingBalance: 900, principalAmount: 1000, totalToCollect: 1500, priorPaidAmount: 450 })).toEqual({
      recovered: 150,
      of: 1050,
      percent: 14,
    });
  });

  it('importado con saldo o capital desconocidos (D9): no hay barra', () => {
    expect(recovery({ balanceBasis: 'total', outstandingBalance: 0, principalAmount: 0, totalToCollect: null, unknownFields: ['outstandingBalance'] })).toBeNull();
    expect(recovery({ balanceBasis: 'principal', outstandingBalance: 500, principalAmount: 0, unknownFields: ['principalAmount'] })).toBeNull();
  });
});

describe('promiseReady', () => {
  it('exige monto > 0, fecha y método', () => {
    expect(promiseReady({ amount: 300, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' })).toBe(true);
    expect(promiseReady({ amount: 0, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' })).toBe(false);
    expect(promiseReady({ amount: 300, promiseDate: '', paymentMethodCode: 'CASH' })).toBe(false);
  });
});
