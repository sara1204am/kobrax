/**
 * Recomendación inicial del espacio de trabajo (F15 · P5, D-12).
 *
 * Es una **sugerencia** que el asistente (P7) explica y la persona puede cambiar; nunca una regla. Se basa solo en el plan:
 * toda cuenta nace con un miembro, así que la cantidad de miembros no dice nada el día 0.
 *
 *  Free → Independiente · Professional → Equipo · Business → Completo.
 *  Sin datos, plan desconocido o Enterprise (no elegible al registrarse) → Independiente: sencillo y seguro.
 */
import { planOf, type PlanCode } from '../constants/plans.js';
import type { WorkspacePresetKey } from './workspace.js';

export interface SetupRecommendation {
  preset: WorkspacePresetKey;
  /** Clave de texto (web, `messages`) que explica por qué: `onboarding.recommend.<plan|fallback>`. */
  reason: string;
}

const BY_PLAN: Readonly<Partial<Record<PlanCode, SetupRecommendation>>> = {
  FREE: { preset: 'independent', reason: 'onboarding.recommend.free' },
  PROFESSIONAL: { preset: 'team', reason: 'onboarding.recommend.professional' },
  BUSINESS: { preset: 'complete', reason: 'onboarding.recommend.business' },
};

const FALLBACK: SetupRecommendation = {
  preset: 'independent',
  reason: 'onboarding.recommend.fallback',
};

export function recommendSetup(ctx: { planCode?: string | null } = {}): SetupRecommendation {
  if (!ctx.planCode) return FALLBACK;
  const plan = planOf(ctx.planCode);
  return (plan && BY_PLAN[plan.code]) || FALLBACK;
}
