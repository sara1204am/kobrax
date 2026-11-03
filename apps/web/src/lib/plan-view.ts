import { PLANS, PLAN_ORDER, type AccountInfo, type PlanCode } from '@kobrax/shared';

/** Los topes que se cuentan (los mismos que dibuja la tarjeta del plan con barra). */
export const COUNTED_LIMITS = ['users', 'credits', 'clients', 'photosPerMonth', 'actionsPerMonth'] as const;
export type CountedLimit = (typeof COUNTED_LIMITS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Días que le quedan a la prueba, redondeados **hacia arriba**: con 2 horas de margen todavía es
 * «hoy», no «vencida». `null` = no hay prueba que contar (otro estado, sin fecha o fecha ilegible).
 * Una prueba ya pasada da 0; el job que la cierra puede tardar y la pantalla no debe mostrar negativos.
 */
export function trialDaysLeft(trialEndsAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

/**
 * Los topes que la cuenta ya **superó** (usa más de lo que su plan permite).
 *
 * Pasa al vencer la prueba o al bajar de plan: lo que exceda queda congelado — se puede seguir
 * cobrando, no sumar. Estar *justo en* el tope no es superarlo (eso es «lleno», no «congelado»).
 */
export function exceededLimits(account: Pick<AccountInfo, 'limits' | 'usage'>): CountedLimit[] {
  return COUNTED_LIMITS.filter((key) => {
    const max = account.limits[key];
    return max !== null && account.usage[key] > max;
  });
}

/**
 * ¿Es un plan para una sola persona? Sale del tope de miembros del catálogo (1) y no del nombre del plan: si mañana
 * cambian los planes, esta distinción los sigue.
 */
export function isIndividualPlan(code: string): boolean {
  return PLANS[code as PlanCode]?.limits.users === 1;
}

/**
 * Los planes a los que se puede pasar, separados en *individual* (una persona) y *equipo* (varias), en el orden de la
 * escalera. El plan actual no se ofrece: pedir el que ya se tiene no tiene sentido.
 */
export function plansByKind(current: string): { individual: PlanCode[]; team: PlanCode[] } {
  const others = PLAN_ORDER.filter((code) => code !== current);
  return {
    individual: others.filter((code) => isIndividualPlan(code)),
    team: others.filter((code) => !isIndividualPlan(code)),
  };
}
