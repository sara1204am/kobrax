import { PLANS, type PlanLimits } from '@kobrax/shared';
import type { CountedLimit, MonthlyCounter, PlanLimitsService } from './plan-limits.service';
import { planLimitReached } from './plan.errors';

/**
 * Doble de `PlanLimitsService` para los specs que **no prueban topes**.
 *
 * Por defecto no frena nada —los topes de ENTERPRISE y cero uso—, así que un spec de clientes o
 * de créditos sigue probando lo suyo sin tener que saber de planes. Quien quiera probar el freno
 * pasa el tope: `fakePlanLimits({ limits: { credits: 2 }, usage: { credits: 2 } })`.
 *
 * La lógica de verdad se prueba en `plan-limits.service.spec.ts` y, contra el servicio real, en
 * `users.service.spec.ts`.
 */
export function fakePlanLimits(
  opts: { limits?: Partial<PlanLimits>; usage?: Partial<Record<CountedLimit, number>> } = {},
): PlanLimitsService {
  const limits: PlanLimits = { ...PLANS.ENTERPRISE.limits, ...opts.limits };
  const usage = { users: 0, credits: 0, clients: 0, ...opts.usage };

  const doble = {
    limitsOf: async () => limits,
    usage: async (kind: CountedLimit) => usage[kind],
    monthlyUsage: async (_kind: MonthlyCounter) => 0,
    usageAll: async () => ({ ...usage, photosPerMonth: 0, actionsPerMonth: 0 }),
    roomLeft: async (kind: CountedLimit) => {
      const max = limits[kind];
      return max === null ? null : Math.max(0, max - usage[kind]);
    },
    assertRoom: async (
      kind: CountedLimit,
      _tx: unknown,
      o: { cuantos?: number; soft?: boolean } = {},
    ) => {
      if (o.soft) return;
      const max = limits[kind];
      if (max === null) return;
      if (usage[kind] + (o.cuantos ?? 1) > max) throw planLimitReached(kind, usage[kind], max);
    },
  };
  return doble as unknown as PlanLimitsService;
}
