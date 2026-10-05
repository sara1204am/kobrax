import { describe, expect, it } from 'vitest';
import type { RouteItem } from '../types/route.types.js';
import { summarizeDay } from './route-day.js';

const route = (stops: Partial<NonNullable<RouteItem['stops']>[number]>[]): RouteItem =>
  ({ id: 'r', collectorId: 'u', plannedDate: '2026-10-04', status: 'IN_PROGRESS', totalCases: stops.length, createdAt: '', stops: stops.map((s, i) => ({ id: 's' + i, clientId: 'c', sequenceOrder: i + 1, status: 'PENDING', ...s })) }) as RouteItem;

describe('summarizeDay · cobrado por crédito (F4/08)', () => {
  it('cruza los pagos con las paradas por creditId e ignora los de otros créditos', () => {
    const r = route([{ creditId: 'cr1' }, { creditId: 'cr2' }]);
    expect(summarizeDay(r, [{ creditId: 'cr1', amount: 100 }, { creditId: 'cr2', amount: 50.5 }, { creditId: 'otro', amount: 999 }]).collected).toBe(150.5);
  });

  it('un pago sin creditId no se cuenta', () => {
    const r = route([{ creditId: 'cr1' }]);
    expect(summarizeDay(r, [{ amount: 10 }]).collected).toBe(0);
  });
});
