/**
 * Lógica pura de la ficha de cobranza (V4, §5.4): intercala pagos y gestiones en un timeline y calcula
 * el progreso recuperado. Sin red, sin React → testeable sola.
 */
import type { CaseActivityItem } from './cases.service';
import type { PaymentItem } from './payments.service';

export type TimelineEntry =
  | { kind: 'payment'; id: string; at: string; amount: number; method: string; receiptUrl?: string }
  | { kind: 'activity'; id: string; at: string; type: string; result?: string; notes?: string };

/** Pagos ∪ gestiones, orden cronológico descendente (lo más reciente arriba). */
export function buildTimeline(activities: CaseActivityItem[], payments: PaymentItem[]): TimelineEntry[] {
  const a: TimelineEntry[] = activities.map((x) => ({
    kind: 'activity',
    id: x.id,
    at: x.createdAt,
    type: x.type,
    result: x.result,
    notes: x.notes,
  }));
  const p: TimelineEntry[] = payments.map((x) => ({
    kind: 'payment',
    id: x.id,
    at: x.paymentDate ?? x.createdAt,
    amount: x.amount,
    method: x.method,
    receiptUrl: x.receiptUrl,
  }));
  return [...a, ...p].sort((x, y) => y.at.localeCompare(x.at));
}

/** Recuperado = capital − saldo, clampado a [0, capital] (§5.4, "Recuperado X de Y"). */
export function recovered(principal: number, outstanding: number): number {
  return Math.max(0, Math.min(principal, principal - outstanding));
}

/** La hoja de gestión-promesa está lista solo con monto > 0, fecha y método (§5.4). */
export function promiseReady(p: { amount: number; promiseDate: string; paymentMethodCode: string }): boolean {
  return p.amount > 0 && !!p.promiseDate && !!p.paymentMethodCode;
}
