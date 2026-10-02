import type { MoraPromise, MoraPromiseStatus } from '@kobrax/shared';

/** Lo que `MoraService` lee de `agenda_items` (sólo `PROMISE_TO_PAY`). */
export interface PromiseRow {
  id: string;
  status: string;
  scheduledDate: Date;
  details: unknown;
  observations: string | null;
  assigneeId: string;
  resultActivityId: string | null;
  createdAt: Date;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * El estado de una promesa. Sale de **tres** cosas que ya existen —el estado del agendado, su fecha y el
 * desenlace de la gestión que la ejecutó (`case_activities.result`)—: no hay una columna que pueda
 * contradecirlas.
 *
 * 🔴 **Vencida sin cerrar no es incumplida.** Si la fecha pasó y nadie registró qué ocurrió, el sistema no
 * sabe si pagó; `OVERDUE` lo dice así, en vez de declararla rota.
 */
export function promiseStatus(row: Pick<PromiseRow, 'status' | 'scheduledDate'>, outcome: string | undefined, now: Date): MoraPromiseStatus {
  switch (row.status) {
    case 'EXECUTED':
      if (outcome === 'PROMISE_KEPT') return 'KEPT';
      if (outcome === 'PROMISE_BROKEN') return 'BROKEN';
      return 'EXECUTED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'RESCHEDULED':
      return 'RESCHEDULED';
    default:
      return utcDay(row.scheduledDate) >= utcDay(now) ? 'ACTIVE' : 'OVERDUE';
  }
}

/** Las promesas de un crédito, **la más reciente primero**. `outcomes`: id de la actividad → su `result`. */
export function serializePromises(rows: PromiseRow[], outcomes: Map<string, string>, now: Date = new Date()): MoraPromise[] {
  return [...rows]
    .sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => {
      const d = (r.details ?? {}) as { amount?: unknown; paymentMethodCode?: unknown; bankCode?: unknown };
      const amount = typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : undefined;
      return {
        id: r.id,
        amount,
        promiseDate: iso(r.scheduledDate),
        status: promiseStatus(r, r.resultActivityId ? outcomes.get(r.resultActivityId) : undefined, now),
        paymentMethodCode: typeof d.paymentMethodCode === 'string' ? d.paymentMethodCode : undefined,
        bankCode: typeof d.bankCode === 'string' ? d.bankCode : undefined,
        assigneeId: r.assigneeId,
        observations: r.observations ?? undefined,
        createdAt: r.createdAt.toISOString(),
      };
    });
}
