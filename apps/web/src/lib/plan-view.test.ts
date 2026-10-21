import { describe, it, expect } from 'vitest';
import { PLANS } from '@kobrax/shared';
import { exceededLimits, trialDaysLeft } from './plan-view';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const usage = { users: 1, credits: 1, clients: 1, photosPerMonth: 1, actionsPerMonth: 1 };

describe('trialDaysLeft', () => {
  it('cuenta hacia arriba: con horas de margen todavía es un día', () => {
    expect(trialDaysLeft('2026-10-22T00:00:00.000Z', NOW)).toBe(1);
    expect(trialDaysLeft('2026-11-20T12:00:00.000Z', NOW)).toBe(30);
  });

  it('la prueba que ya pasó da 0, nunca negativo', () => {
    expect(trialDaysLeft('2026-10-01T00:00:00.000Z', NOW)).toBe(0);
  });

  it('sin fecha o con basura no hay prueba que contar', () => {
    expect(trialDaysLeft(null, NOW)).toBeNull();
    expect(trialDaysLeft(undefined, NOW)).toBeNull();
    expect(trialDaysLeft('no-es-fecha', NOW)).toBeNull();
  });
});

describe('exceededLimits', () => {
  it('justo en el tope no es superarlo', () => {
    expect(exceededLimits({ limits: PLANS.FREE.limits, usage: { ...usage, users: 1, credits: 20 } })).toEqual([]);
  });

  it('lista los topes pasados, en el orden de la tarjeta', () => {
    expect(
      exceededLimits({ limits: PLANS.FREE.limits, usage: { ...usage, users: 5, clients: 30 } }),
    ).toEqual(['users', 'clients']);
  });

  it('un tope sin límite nunca se supera', () => {
    const limits = { ...PLANS.FREE.limits, users: null };
    expect(exceededLimits({ limits, usage: { ...usage, users: 9999 } })).toEqual([]);
  });
});
