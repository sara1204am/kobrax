import type { MoraPromise } from '../types/mora.types.js';

/**
 * El resumen de las promesas de pago de un crédito, **calculado una vez** para que el panel y el móvil digan
 * lo mismo.
 *
 * 🔴 **El cumplimiento sólo cuenta las promesas con desenlace** (`KEPT` y `BROKEN`). Una promesa vencida que
 * nadie cerró (`OVERDUE`) no es incumplida: no se sabe, y contarla como rota castigaría al deudor por una
 * gestión que el equipo no registró. Sin ninguna con desenlace no hay porcentaje (`undefined`), no 0 %.
 */
export interface PromiseSummary {
  /** Todas las que se hicieron (menos las movidas de fecha, que se cuentan en su reemplazo). */
  made: number;
  active: number;
  /** Vencidas sin desenlace registrado. */
  unresolved: number;
  kept: number;
  broken: number;
  /** `kept / (kept + broken)`, 0..1. `undefined` si ninguna tiene desenlace. */
  complianceRate?: number;
}

export function summarizePromises(promises: readonly MoraPromise[]): PromiseSummary {
  const count = (status: MoraPromise['status']) => promises.filter((p) => p.status === status).length;
  const kept = count('KEPT');
  const broken = count('BROKEN');
  return {
    made: promises.filter((p) => p.status !== 'RESCHEDULED').length,
    active: count('ACTIVE'),
    unresolved: count('OVERDUE'),
    kept,
    broken,
    complianceRate: kept + broken > 0 ? kept / (kept + broken) : undefined,
  };
}
