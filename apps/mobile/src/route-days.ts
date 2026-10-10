/**
 * Los días en que se puede armar una ruta (D-6): hoy y hasta `ROUTE_MAX_DAYS_AHEAD` días hacia adelante. **Funciones puras**
 * sobre fechas `YYYY-MM-DD`: nada de `Date` local, así el «hoy» es el de la empresa (`todayISO`) y no el del teléfono.
 *
 * El tope real lo pone la API (`ROUTE_TOO_FAR`); acá se usa el mismo número, de `@kobrax/shared`, para no ofrecer días que
 * el servidor va a rebotar.
 */
import { ROUTE_MAX_DAYS_AHEAD } from '@kobrax/shared';

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` + `n` días, sin pasar por la zona horaria del teléfono. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface PlanningDay {
  date: string;
  /** «Hoy», «Mañana» o el día de la semana. */
  label: string;
  /** El número del día del mes. */
  dayOfMonth: string;
  /** Cuántos días faltan (0 = hoy). */
  offset: number;
}

/** Hoy y los `max` días siguientes, en orden. */
export function planningDays(today: string, max: number = ROUTE_MAX_DAYS_AHEAD): PlanningDay[] {
  return Array.from({ length: max + 1 }, (_, offset) => {
    const date = addDays(today, offset);
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return {
      date,
      label: offset === 0 ? 'Hoy' : offset === 1 ? 'Mañana' : WEEKDAYS[weekday]!,
      dayOfMonth: String(d),
      offset,
    };
  });
}

/** ¿Es un día que se puede planificar (formato válido, no pasado, dentro del tope)? */
export function isPlannableDay(date: string | undefined | null, today: string, max: number = ROUTE_MAX_DAYS_AHEAD): date is string {
  if (!date || !DAY.test(date)) return false;
  return date >= today && date <= addDays(today, max);
}
