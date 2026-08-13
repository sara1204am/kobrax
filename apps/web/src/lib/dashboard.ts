import { CasePriority, CaseStatus, type DashboardFilters, type KpiValue } from '@kobrax/shared';
import { isUuid } from './uuid';

/**
 * Los filtros del dashboard: **viven en la URL**, como en todo el panel.
 *
 * Así el tablero se puede compartir por link, el botón «atrás» funciona y recargar no pierde lo que
 * la persona estaba mirando. Nada de estado global.
 */

const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (d: Date): string => d.toISOString().slice(0, 10);
const shift = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

/**
 * Los atajos del selector de fechas. Devuelven `{from, to}` en `YYYY-MM-DD`.
 *
 * Van con código y no con rótulo: el panel es bilingüe y el texto vive en los diccionarios.
 */
export const DATE_PRESETS = ['today', 'yesterday', 'd7', 'd30', 'month', 'prevMonth'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export function presetRange(preset: DatePreset, today = new Date()): { from: string; to: string } {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  switch (preset) {
    case 'today':
      return { from: day(t), to: day(t) };
    case 'yesterday':
      return { from: day(shift(t, -1)), to: day(shift(t, -1)) };
    case 'd7':
      // 7 días **contando hoy**: del lunes al domingo son 7, no 8. Con `-7` la semana traía ocho
      // días y el «vs período anterior» comparaba contra un rango corrido.
      return { from: day(shift(t, -6)), to: day(t) };
    case 'd30':
      return { from: day(shift(t, -29)), to: day(t) };
    case 'month':
      return { from: day(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), to: day(t) };
    case 'prevMonth': {
      const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
      return { from: day(first), to: day(last) };
    }
  }
}

/**
 * Lo que llegó por la URL, ya limpio.
 *
 * 🔴 **Un id inventado no viaja.** `collectorId` y `branchId` entran a la query de la API, que los
 * valida como uuid y contesta 400 — y un 400 acá no rompe un widget: rompe **los seis**, porque
 * todos comparten los mismos filtros. Se descartan antes de salir.
 */
export function dashboardFilters(
  params: Record<string, string | undefined>,
  today = new Date(),
): DashboardFilters {
  const fallback = presetRange('d7', today);
  const from = params.from && IS_DAY.test(params.from) ? params.from : fallback.from;
  const to = params.to && IS_DAY.test(params.to) ? params.to : fallback.to;

  return {
    // Un rango al revés no es un error del que haya que avisar: se da vuelta y listo.
    dateFrom: from <= to ? from : to,
    dateTo: from <= to ? to : from,
    ...(params.collectorId && isUuid(params.collectorId) ? { collectorId: params.collectorId } : {}),
    ...(params.branchId && isUuid(params.branchId) ? { branchId: params.branchId } : {}),
    // Los dos enums se validan por el mismo motivo que los ids: la API los valida con `@IsEnum` y un
    // valor inventado en la URL le contesta 400 **a los seis endpoints**, no a uno.
    ...(isCaseStatus(params.caseStatus) ? { caseStatus: params.caseStatus } : {}),
    ...(isPriority(params.priority) ? { priority: params.priority } : {}),
  };
}

const isCaseStatus = (value?: string): value is CaseStatus =>
  !!value && (Object.values(CaseStatus) as string[]).includes(value);

const isPriority = (value?: string): value is CasePriority =>
  !!value && (Object.values(CasePriority) as string[]).includes(value);

/** Los mismos filtros, como query para la API. Los seis endpoints reciben exactamente esto. */
export function analyticsQuery(filters: DashboardFilters): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
  return query;
}

/**
 * La variación contra el período anterior.
 *
 * 🔴 **`null` cuando no se puede saber**, y no es lo mismo que 0 %: la API devuelve `previous: null`
 * en los saldos porque la base no guarda su historia. Devolver 0 acá dibujaría una flecha inventada
 * sobre plata.
 *
 * Y con un anterior en cero tampoco hay porcentaje: pasar de 0 a 500 no es «+∞ %», es una primera
 * vez. Se muestra el número, no una variación.
 */
export function deltaOf(kpi: KpiValue): { pct: number; up: boolean } | null {
  if (kpi.previous === null || kpi.previous === 0) return null;
  const pct = ((kpi.value - kpi.previous) / Math.abs(kpi.previous)) * 100;
  return { pct: Math.round(pct * 10) / 10, up: pct >= 0 };
}
