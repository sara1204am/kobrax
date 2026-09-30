/**
 * Lógica pura de la ficha de cobranza (V4, §5.4): intercala pagos y gestiones en un timeline y calcula
 * el progreso recuperado. Sin red, sin React → testeable sola.
 */
import { isUnknownField, paymentProgress, type EffectiveBalanceBasis } from '@kobrax/shared';
import type { CaseActivityItem } from './cases.service';
import type { NewPayment, PaymentItem } from './payments.service';

export type TimelineEntry =
  | { kind: 'payment'; id: string; at: string; amount: number; method: string; receiptUrl?: string; pending?: boolean }
  | { kind: 'activity'; id: string; at: string; type: string; result?: string; notes?: string };

/** Pagos ∪ gestiones, orden cronológico descendente (lo más reciente arriba). */
export function buildTimeline(activities: CaseActivityItem[], payments: (PaymentItem & { pending?: boolean })[]): TimelineEntry[] {
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
    pending: x.pending,
  }));
  return [...a, ...p].sort((x, y) => y.at.localeCompare(x.at));
}

/**
 * Los pagos de ESTE caso que todavía están en la cola del teléfono (cobrados sin señal), como filas del
 * historial marcadas `pending`. Así el cobrador ve su cobro en el acto, en vez de un historial que no
 * lo muestra hasta que vuelva la red — que es cuando más dudaría de si quedó guardado.
 *
 * La fecha es la del cobro (`paymentDate` del pedido), y si no la trae, la de cuando se encoló.
 */
export function queuedPayments(
  caseId: string,
  queued: readonly { action: { kind: string; input?: unknown; idempotencyKey?: string }; createdAt: number }[],
): (PaymentItem & { pending: true })[] {
  return queued.flatMap(({ action, createdAt }) => {
    if (action.kind !== 'payment' || !action.input) return [];
    const input = action.input as NewPayment;
    if (input.caseId !== caseId) return [];
    const at = input.paymentDate ?? new Date(createdAt).toISOString();
    return [
      {
        id: `pending-${action.idempotencyKey ?? createdAt}`,
        creditId: input.creditId,
        caseId: input.caseId,
        amount: input.amount,
        method: input.method,
        paymentDate: at,
        createdAt: at,
        pending: true as const,
      },
    ];
  });
}

/**
 * «Recuperado X de Y» (§5.4), medido contra lo que representa el saldo (D15, F4/06 · Fase 5).
 *
 * 🔴 **Antes medía siempre contra el capital.** Con saldo = total pendiente (capital + ganancia), un
 * préstamo de 1.000 que debe 1.500 aparecía con «Recuperado 0 de 1.000» después de cobrar 400.
 *
 *  · base `total` → contra el total por cobrar; sin total conocido no hay barra (no se inventa);
 *  · `principal` (préstamo abierto) y `legacy` (sin migrar) → contra el capital, como antes;
 *  · saldo o capital desconocidos (importado, D9) → no hay barra.
 *
 * El porcentaje sale de `paymentProgress` de shared: el mismo número que la barra de la web.
 */
export function recovery(credit: {
  balanceBasis?: EffectiveBalanceBasis;
  outstandingBalance: number;
  principalAmount: number;
  totalToCollect?: number | null;
  unknownFields?: readonly string[];
  /** Lo pagado antes de registrarlo en Kobrax (D13): no cuenta como recuperado. */
  priorPaidAmount?: number;
}): { recovered: number; of: number; percent: number } | null {
  const basis = credit.balanceBasis ?? 'legacy';
  if (isUnknownField(credit, 'outstandingBalance')) return null;
  if (basis !== 'total' && isUnknownField(credit, 'principalAmount')) return null;
  const prior = basis === 'total' ? (credit.priorPaidAmount ?? 0) : 0;
  const of = basis === 'total' ? (credit.totalToCollect == null ? null : credit.totalToCollect - prior) : credit.principalAmount;
  const percent = paymentProgress({
    basis,
    outstandingBalance: credit.outstandingBalance,
    principalAmount: credit.principalAmount,
    totalToCollect: credit.totalToCollect ?? null,
    priorPaidAmount: credit.priorPaidAmount,
  });
  if (of === null || percent === null) return null;
  return { recovered: Math.max(0, Math.min(of, of - credit.outstandingBalance)), of, percent };
}

/** La hoja de gestión-promesa está lista solo con monto > 0, fecha y método (§5.4). */
export function promiseReady(p: { amount: number; promiseDate: string; paymentMethodCode: string }): boolean {
  return p.amount > 0 && !!p.promiseDate && !!p.paymentMethodCode;
}
