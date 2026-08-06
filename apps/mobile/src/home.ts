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
