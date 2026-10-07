import { toISO } from '@kobrax/shared';

/**
 * «Hoy» **para la empresa**, no para el reloj del teléfono ni para UTC (F4/11 · E6).
 *
 * 🔴 Antes el móvil usaba el día UTC: en Bolivia (UTC−4), desde las 20:00 pedía la agenda de MAÑANA y el contador de
 * pendientes dejaba de coincidir con lo que dice el servidor y con lo que ve el panel. El servidor cuenta con el día civil
 * de la empresa y lo devuelve en `GET /agenda/summary` (`date`); acá se guarda ese día junto con qué día LOCAL era en el
 * teléfono cuando lo dijo. Sin red el día sigue avanzando con el reloj del teléfono, corrido por esa diferencia: si el
 * teléfono y la empresa están en la misma zona la diferencia es 0 y esto es simplemente el día local.
 *
 * Sin haber hablado nunca con el servidor (primer arranque sin red) cae al día local del teléfono, que para un cobrador en
 * su zona es el correcto — y nunca al UTC.
 */
interface Known {
  /** El día de la empresa que dijo el servidor. */
  day: string;
  /** Qué día local era en el teléfono en ese momento. */
  localAt: string;
}

let known: Known | null = null;

const MS_DAY = 86_400_000;
const utc = (iso: string): number => Date.parse(`${iso}T00:00:00.000Z`);
const addDays = (iso: string, n: number): string => new Date(utc(iso) + n * MS_DAY).toISOString().slice(0, 10);
const diffDays = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / MS_DAY);

/** El servidor dijo qué día es para la empresa. */
export function setTenantToday(day: string, now: Date = new Date()): void {
  known = { day, localAt: toISO(now) };
}

/** Hoy, como `YYYY-MM-DD`: el día de la empresa si se conoce, y si no el día local del teléfono. */
export function todayISO(now: Date = new Date()): string {
  const local = toISO(now);
  if (!known) return local;
  // Los días LOCALES que pasaron desde que el servidor lo dijo, sumados a lo que dijo.
  return addDays(known.day, diffDays(known.localAt, local));
}

/** Solo para las pruebas: vuelve a «nunca hablé con el servidor». */
export function resetTenantToday(): void {
  known = null;
}
