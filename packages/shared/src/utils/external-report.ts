/**
 * Qué tan viejo es el dato de una operación externa (D9).
 *
 * La mora y el saldo de un PSF son los del **reporte**, a su fecha de corte (`reportedAsOf`), no los
 * de hoy. Si el reporte deja de llegar, esos números siguen en pantalla y siguen pareciendo actuales:
 * pasados `staleAfterDays` días desde el corte, el dato se marca como desactualizado y el trabajo
 * diario deja de abrir o reabrir casos con él.
 */

/** Días desde el corte a partir de los cuales el dato se considera viejo, si el formato no dice otro. */
export const DEFAULT_REPORT_STALE_AFTER_DAYS = 2;

/** Los límites que acepta la configuración del formato. */
export const REPORT_STALE_AFTER_DAYS_MIN = 1;
export const REPORT_STALE_AFTER_DAYS_MAX = 60;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` de una fecha (o el mismo texto recortado). */
function isoDay(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Días enteros entre la fecha de corte y `today`. `null` si no hay fecha de corte.
 *
 * Se cuenta entre días calendario (sin horas): un corte de ayer tiene 1 día, sea la hora que sea.
 * Un corte con fecha futura —pasa con reportes que se suben por adelantado— tiene 0, no negativo.
 */
export function reportAgeDays(reportedAsOf: Date | string | null | undefined, today: Date | string): number | null {
  if (!reportedAsOf) return null;
  const diff = Date.parse(isoDay(today)) - Date.parse(isoDay(reportedAsOf));
  if (Number.isNaN(diff)) return null;
  return Math.max(0, Math.round(diff / DAY_MS));
}

/**
 * Si el dato reportado ya está viejo. **Sin fecha de corte no es «viejo»**: es desconocido, y quien lo
 * muestra ya lo presenta como tal (D9) — marcarlo desactualizado sería afirmar algo que no se sabe.
 */
export function isReportStale(
  reportedAsOf: Date | string | null | undefined,
  today: Date | string,
  staleAfterDays: number = DEFAULT_REPORT_STALE_AFTER_DAYS,
): boolean {
  const age = reportAgeDays(reportedAsOf, today);
  return age !== null && age > staleAfterDays;
}

/** El umbral configurado, o el default si falta o no es un entero válido. */
export function staleAfterDaysOf(raw: unknown): number {
  return typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= REPORT_STALE_AFTER_DAYS_MIN &&
    raw <= REPORT_STALE_AFTER_DAYS_MAX
    ? raw
    : DEFAULT_REPORT_STALE_AFTER_DAYS;
}
