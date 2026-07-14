import type { CaseActivityItem } from './cases.service';
import type { PaymentItem } from './payments.service';
import { buildTimeline, promiseReady, recovered } from './ficha';

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

describe('recovered', () => {
  it('capital − saldo, clampado a [0, capital]', () => {
    expect(recovered(1000, 400)).toBe(600);
    expect(recovered(1000, 0)).toBe(1000);
    expect(recovered(1000, 1200)).toBe(0); // saldo mayor que el capital (mora capitalizada) → 0, no negativo
  });
});

describe('promiseReady', () => {
  it('exige monto > 0, fecha y método', () => {
    expect(promiseReady({ amount: 300, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' })).toBe(true);
    expect(promiseReady({ amount: 0, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' })).toBe(false);
    expect(promiseReady({ amount: 300, promiseDate: '', paymentMethodCode: 'CASH' })).toBe(false);
  });
});
