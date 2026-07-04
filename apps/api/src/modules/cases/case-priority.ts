import { CasePriority } from '@prisma/client';

/**
 * Cálculo puro de prioridad y SLA de un caso (testeable, configurable por tenant).
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
  /** Horas de SLA por prioridad (vencimiento = ahora + horas). */
  slaHours: Record<CasePriority, number>;
}

export const DEFAULT_PRIORITY_PARAMS: PriorityParams = {
  amountWeight: 1,
  daysWeight: 1,
  riskWeights: { HIGH: 30, MEDIUM: 15, LOW: 0 },
  thresholds: { critical: 100, high: 60, medium: 30 },
  slaHours: { CRITICAL: 24, HIGH: 48, MEDIUM: 72, LOW: 120 },
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
): CasePriority {
  const score = priorityScore(input, params);
  if (score >= params.thresholds.critical) return CasePriority.CRITICAL;
  if (score >= params.thresholds.high) return CasePriority.HIGH;
  if (score >= params.thresholds.medium) return CasePriority.MEDIUM;
  return CasePriority.LOW;
}

export function slaDueAt(
  priority: CasePriority,
  asOf: Date,
  params: PriorityParams = DEFAULT_PRIORITY_PARAMS,
): Date {
  const hours = params.slaHours[priority] ?? 72;
  return new Date(asOf.getTime() + hours * 60 * 60 * 1000);
}
