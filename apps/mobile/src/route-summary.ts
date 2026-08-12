/**
 * Los rótulos del resumen de la jornada (Rutas S6 · RT-7).
 *
 * **Las cuentas viven en `@kobrax/shared`** (F9 W6 T1): `summarizeDay` es la ÚNICA cuenta del día
 * —existe porque dos pantallas del mismo día decían cosas distintas— y ahora la comparten el
 * teléfono y el panel. Acá se quedan el texto y el color, que son de esta app.
 */
import type { ResultCategory } from '@kobrax/shared';

export { categoryOf, routeProgress, summarizeDay } from '@kobrax/shared';
export type { DaySummary, ResultCategory } from '@kobrax/shared';

export const CATEGORY_LABEL: Record<ResultCategory, string> = {
  COLLECTED: 'Cobrados',
  PROMISED: 'Promesas',
  NO_ANSWER: 'No contesta',
  UNREACHABLE: 'Inubicables',
  OTHER: 'Otros',
};

/** El tono del punto de color de cada tarjeta (RT-7). */
export const CATEGORY_TONE: Record<ResultCategory, 'success' | 'warning' | 'danger' | 'neutral'> = {
  COLLECTED: 'success',
  PROMISED: 'warning',
  NO_ANSWER: 'danger',
  UNREACHABLE: 'neutral',
  OTHER: 'neutral',
};
