import { RouteStatus, RouteStopStatus, VisitOutcome } from '@kobrax/shared';
import { categoryOf, summarizeDay } from './route-summary';
import type { RouteItem, RouteStopItem } from './routes.service';
import type { PaymentItem } from './payments.service';

let n = 0;
function stop(over: Partial<RouteStopItem> = {}): RouteStopItem {
  n += 1;
  return {
    id: `s${n}`,
    clientId: `cl${n}`,
    caseId: `ca${n}`,
    sequenceOrder: n,
    status: RouteStopStatus.PENDING,
    currency: 'BOB',
    ...over,
  } as RouteStopItem;
}

const route = (stops: RouteStopItem[]): RouteItem =>
  ({ id: 'r1', collectorId: 'u1', status: RouteStatus.IN_PROGRESS, plannedDate: '2026-08-05', totalCases: stops.length, createdAt: '', stops }) as RouteItem;

const pay = (caseId: string | undefined, amount: number): PaymentItem =>
  ({ id: `p${amount}`, creditId: 'cr1', caseId, amount, method: 'CASH', paymentDate: '', createdAt: '' }) as PaymentItem;

describe('categoryOf', () => {
  it('cobrado total y parcial son la misma categoría', () => {
    expect(categoryOf(VisitOutcome.PAID)).toBe('COLLECTED');
    expect(categoryOf(VisitOutcome.PARTIAL_PAYMENT)).toBe('COLLECTED');
  });

  it('no encontrarlo y la dirección equivocada caen juntos en inubicables', () => {
    // S5 los separa para poder corregir el domicilio; para el cierre del día son lo mismo.
    expect(categoryOf(VisitOutcome.NOT_FOUND)).toBe('UNREACHABLE');
    expect(categoryOf(VisitOutcome.WRONG_ADDRESS)).toBe('UNREACHABLE');
  });

  it('lo que el mockup no contempla va a Otros, no se pierde', () => {
    expect(categoryOf(VisitOutcome.SPECIAL)).toBe('OTHER');
    expect(categoryOf(VisitOutcome.REFUSAL)).toBe('OTHER');
    expect(categoryOf(VisitOutcome.CONTACTED)).toBe('OTHER');
  });
});

describe('summarizeDay · progreso y categorías', () => {
  it('cuenta sólo las paradas con resultado', () => {
    const r = route([
      stop({ lastOutcome: VisitOutcome.PAID }),
      stop({ lastOutcome: VisitOutcome.PROMISE_TO_PAY }),
      stop(), // sin visitar
    ]);
    const s = summarizeDay(r);
    expect(s.done).toBe(2);
    expect(s.total).toBe(3);
    expect(s.percent).toBe(67);
  });

  it('sólo devuelve las categorías que tienen algo, en el orden del mockup', () => {
    const r = route([
      stop({ lastOutcome: VisitOutcome.NOT_FOUND }),
      stop({ lastOutcome: VisitOutcome.PAID }),
      stop({ lastOutcome: VisitOutcome.PAID }),
    ]);
    expect(summarizeDay(r).categories).toEqual([
      { key: 'COLLECTED', count: 2 },
      { key: 'UNREACHABLE', count: 1 },
    ]);
  });

  it('una ruta vacía no rompe ni devuelve NaN', () => {
    const s = summarizeDay(route([]));
    expect(s).toMatchObject({ done: 0, total: 0, percent: 0, collected: 0, categories: [] });
  });
});

describe('summarizeDay · recaudado', () => {
  it('suma SÓLO los pagos de las paradas de esta ruta', () => {
    const a = stop({ lastOutcome: VisitOutcome.PAID });
    const b = stop({ lastOutcome: VisitOutcome.PAID });
    // El tercero es de otra ruta: `GET /payments` devuelve los del tenant entero.
    const s = summarizeDay(route([a, b]), [pay(a.caseId, 100), pay(b.caseId, 50.5), pay('ca-ajeno', 999)]);
    expect(s.collected).toBe(150.5);
  });

  it('un pago sin caso no se suma (no se puede probar que sea de esta ruta)', () => {
    const a = stop({ lastOutcome: VisitOutcome.PAID });
    expect(summarizeDay(route([a]), [pay(undefined, 300)]).collected).toBe(0);
  });

  it('sin pagos el recaudado es cero, no undefined', () => {
    expect(summarizeDay(route([stop()])).collected).toBe(0);
  });

  it('redondea a centavos y no arrastra el error de coma flotante', () => {
    const a = stop({ lastOutcome: VisitOutcome.PAID });
    const s = summarizeDay(route([a]), [pay(a.caseId, 0.1), pay(a.caseId, 0.2)]);
    expect(s.collected).toBe(0.3);
  });

  it('la moneda sale de las paradas', () => {
    expect(summarizeDay(route([stop({ currency: 'USD' })])).currency).toBe('USD');
    // Sin moneda cargada no se queda en blanco.
    expect(summarizeDay(route([stop({ currency: undefined })])).currency).toBe('BOB');
  });
});
