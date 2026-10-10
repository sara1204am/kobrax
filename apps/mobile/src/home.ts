/**
 * Las cuentas del Inicio (Home · Figma `42:3069`). Puras, sin red ni React.
 *
 * **Se calculan en el cliente a propósito** (decisión cerrada, `ui-screen-map §8.1`): son
 * contadores intradía de lo que el cobrador acaba de hacer, y hasta que sincronice el dispositivo
 * tiene el dato más fresco que el server. Mismo criterio que `route-summary.ts`.
 */
import { AgendaItemStatus, ScheduleTimeMode } from '@kobrax/shared';
import { partitionDay } from './agenda-form';
import type { AgendaListItem } from './agenda.service';

export interface DayProgress {
  /** Gestiones del día ya resueltas (ejecutadas, canceladas o reagendadas). */
  done: number;
  pending: number;
  total: number;
  /** 0–100, redondeado. `0` si el día está vacío (y no `NaN`). */
  percent: number;
}

/**
 * El avance del día. Cuenta como resuelto todo lo que ya no espera al cobrador — incluidas las
 * canceladas y las reagendadas: siguen visibles en el día (regla del módulo Agenda), pero no son
 * trabajo pendiente, y contarlas como tal dejaría un progreso que nunca llega a 100%.
 */
export function dayProgress(items: AgendaListItem[]): DayProgress {
  const { pending, done } = partitionDay(items);
  const total = items.length;
  return {
    done: done.length,
    pending: pending.length,
    total,
    percent: total > 0 ? Math.round((done.length / total) * 100) : 0,
  };
}

/**
 * Lo que arranca en los próximos minutos, para la banda de urgencia. Sólo cuentan las de **hora
 * fija**: una gestión de franja ("por la mañana") no tiene minuto que comparar, y meterla acá
 * haría sonar la alarma todo el día.
 *
 * `now` entra por parámetro para poder testearlo sin congelar el reloj.
 */
export function dueSoon(items: AgendaListItem[], now: Date, minutes = 30): AgendaListItem[] {
  const desde = now.getTime();
  const hasta = desde + minutes * 60_000;
  return items
    .filter((i) => i.status === AgendaItemStatus.SCHEDULED && i.timeMode === ScheduleTimeMode.FIXED && i.scheduledTime)
    .filter((i) => {
      const t = atTime(now, i.scheduledTime!);
      return t !== null && t >= desde && t <= hasta;
    });
}

/** Lo mínimo de una acción encolada que le interesa al «cobrado hoy». */
export interface QueuedForTotal {
  action: { kind: string; input?: unknown; payment?: unknown };
  createdAt: number;
}

function sameLocalDay(ms: number, now: Date): boolean {
  const d = new Date(ms);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/**
 * Lo cobrado hoy que **todavía está en la cola del teléfono** (cobrado sin señal): los pagos sueltos
 * (`payment`) y los que viajan dentro de una visita (`visit.payment`). Sin esto, el Home decía «Bs 0» justo
 * después de cobrar sin señal — el dato más fresco que tiene el dispositivo es el que se le escondía.
 * Un cobro es «de hoy» por la hora en que se hizo (`paymentDate`) o, si no la trae, por cuándo se encoló.
 */
export function queuedCollectedToday(queued: readonly QueuedForTotal[], now: Date = new Date()): number {
  let total = 0;
  for (const { action, createdAt } of queued) {
    let payment: { amount?: number; paymentDate?: string } | undefined;
    if (action.kind === 'payment') payment = action.input as typeof payment;
    else if (action.kind === 'visit') payment = action.payment as typeof payment;
    if (!payment || typeof payment.amount !== 'number') continue;
    const at = payment.paymentDate ? Date.parse(payment.paymentDate) : createdAt;
    if (sameLocalDay(Number.isNaN(at) ? createdAt : at, now)) total += payment.amount;
  }
  return total;
}

/** `HH:mm` de HOY en hora local → epoch ms. `null` si el texto no es una hora. */
function atTime(now: Date, hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min).getTime();
}

/**
 * Las próximas gestiones a hacer, en orden de hora. Las de hora fija van primero y ordenadas; las
 * de franja horaria van después, porque no hay con qué ordenarlas y no son lo inminente.
 */
export function upNext(items: AgendaListItem[], limit = 3): AgendaListItem[] {
  const pendientes = items.filter((i) => i.status === AgendaItemStatus.SCHEDULED);
  const conHora = pendientes
    .filter((i) => i.timeMode === ScheduleTimeMode.FIXED && i.scheduledTime)
    .sort((a, b) => a.scheduledTime!.localeCompare(b.scheduledTime!));
  const sinHora = pendientes.filter((i) => !(i.timeMode === ScheduleTimeMode.FIXED && i.scheduledTime));
  return [...conHora, ...sinHora].slice(0, limit);
}

/** Los tres contadores del resumen de hoy, listos para pintar y con su frescura. */
export interface SummaryView {
  effectiveContacts: number | null;
  promisesDue: number | null;
  promisesTaken: number | null;
  /** `fresh` = recién bajado; `cached` = de la copia guardada, del día de hoy; `outdated` = de otro día (no se muestran cifras). */
  freshness: 'fresh' | 'cached' | 'outdated' | 'none';
  /** `HH:mm` de cuándo se calculó, para decir «datos de las 08:15». */
  asOf?: string;
}

/**
 * Qué decirle al cobrador del resumen del servidor. 🔴 Un resumen guardado de **ayer** no se pasa por el de hoy: sus cifras se
 * ocultan (`outdated`) en vez de mostrarse como actuales. Uno guardado de hoy se muestra, pero marcado con su hora.
 */
export function summaryView(
  res: { status: string; data?: { date: string; generatedAt?: string; effectiveContacts?: number; promisesDue?: number; promisesTaken?: number }; localAt?: number | null },
  today: string,
): SummaryView {
  if (res.status !== 'ok' || !res.data) return { effectiveContacts: null, promisesDue: null, promisesTaken: null, freshness: 'none' };
  const d = res.data;
  const asOf = d.generatedAt && !Number.isNaN(Date.parse(d.generatedAt)) ? hhmm(new Date(d.generatedAt)) : undefined;
  if (d.date !== today) return { effectiveContacts: null, promisesDue: null, promisesTaken: null, freshness: 'outdated', ...(asOf ? { asOf } : {}) };
  // Un servidor viejo no manda los contadores: no se inventan.
  const n = (v: number | undefined) => (typeof v === 'number' ? v : null);
  return {
    effectiveContacts: n(d.effectiveContacts),
    promisesDue: n(d.promisesDue),
    promisesTaken: n(d.promisesTaken),
    freshness: res.localAt != null ? 'cached' : 'fresh',
    ...(asOf ? { asOf } : {}),
  };
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
