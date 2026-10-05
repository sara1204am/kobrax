import { CollectionPriority } from '@prisma/client';

/**
 * Cálculo puro de la prioridad de un episodio de mora (testeable, configurable por tenant).
 * Prioriza la cartera crítica: score = saldo + días de mora + riesgo del cliente.
 */
export interface PriorityParams {
  /** Peso del saldo (por cada 1000 de saldo). */
  amountWeight: number;
  /** Peso por día de mora. */
  daysWeight: number;
  /** Peso por segmento de riesgo del cliente. */
  riskWeights: Record<string, number>;
  /** Umbrales de score → prioridad. */
  thresholds: { critical: number; high: number; medium: number };
}

export const DEFAULT_PRIORITY_PARAMS: PriorityParams = {
  amountWeight: 1,
  daysWeight: 1,
  riskWeights: { HIGH: 30, MEDIUM: 15, LOW: 0 },
  thresholds: { critical: 100, high: 60, medium: 30 },
};

export function priorityScore(
  input: { outstandingBalance: number; daysPastDue: number; riskSegment?: string | null },
  params: PriorityParams = DEFAULT_PRIORITY_PARAMS,
): number {
  const amount = (input.outstandingBalance / 1000) * params.amountWeight;
  const days = input.daysPastDue * params.daysWeight;
  const risk = params.riskWeights[(input.riskSegment ?? '').toUpperCase()] ?? 0;
  return amount + days + risk;
}

export function computePriority(
  input: { outstandingBalance: number; daysPastDue: number; riskSegment?: string | null },
  params: PriorityParams = DEFAULT_PRIORITY_PARAMS,
): CollectionPriority {
  const score = priorityScore(input, params);
  if (score >= params.thresholds.critical) return CollectionPriority.CRITICAL;
  if (score >= params.thresholds.high) return CollectionPriority.HIGH;
  if (score >= params.thresholds.medium) return CollectionPriority.MEDIUM;
  return CollectionPriority.LOW;
}

/**
 * Los parámetros de prioridad de una cuenta: los de fábrica con lo que `configuration.casePriority` pise.
 * La clave `casePriority` se conserva tal cual porque ya está guardada en `accounts.configuration`.
 */
export function priorityParamsOf(configuration: unknown): PriorityParams {
  const cfg = (configuration ?? {}) as { casePriority?: Partial<PriorityParams> };
  return { ...DEFAULT_PRIORITY_PARAMS, ...(cfg.casePriority ?? {}) };
}
