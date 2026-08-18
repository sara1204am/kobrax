import type { PaymentItem } from '@kobrax/shared';
import { PAGE_SIZES } from './table-prefs';
import { isUuid } from './uuid';

/**
 * El período que se está mirando, en `YYYY-MM-DD`. Por defecto, el mes corriente: un ledger se lee
 * por período, no por día — al revés que la agenda o las rutas, que son de una jornada.
 */
export function defaultPeriod(today = new Date()): { from: string; to: string } {
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: first.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Lo que la pantalla de Pagos sabe leer de la URL. Las claves son las que escribe el `DataTable`. */
export interface PaymentParams {
  from?: string;
  to?: string;
  /** Llegan por link desde la ficha del crédito o del caso; no se escriben a mano. */
  creditId?: string;
  caseId?: string;
  page?: string;
  pageSize?: string;
}

/** Cuántos pagos por página si nadie eligió otra cosa. */
export const DEFAULT_PAGE_SIZE = 25;

/** El tamaño de página pedido, o el default. Un valor inventado es un 400, no una lista más larga. */
export function paymentLimit(params: PaymentParams): number {
  return PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : DEFAULT_PAGE_SIZE;
}

/**
 * La query para `GET /payments`.
 *
 * 🔴 **`to` viaja con el final del día.** `paymentDate` es un timestamp, así que mandando la fecha
 * pelada el límite queda en medianoche y **los pagos de ese día no entran**: es exactamente el
 * defecto que W6 tuvo en el «recaudado» de una ruta, donde daba siempre cero. El móvil ya lo hacía
 * bien; acá se hereda.
 *
 * 🔴 **El crédito y el caso se validan como uuid antes de viajar**: el DTO los valida, y un valor de
 * más en la URL —o una preferencia guardada— devolvería 400 y dejaría el ledger entero vacío.
 */
export function paymentQuery(params: PaymentParams, today = new Date()): URLSearchParams {
  const period = defaultPeriod(today);
  const from = params.from && IS_DAY.test(params.from) ? params.from : period.from;
  const to = params.to && IS_DAY.test(params.to) ? params.to : period.to;

  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({
    from,
    to: `${to}T23:59:59.999Z`,
    page: String(page),
    limit: String(paymentLimit(params)),
  });
  if (params.creditId && isUuid(params.creditId)) query.set('creditId', params.creditId);
  if (params.caseId && isUuid(params.caseId)) query.set('caseId', params.caseId);
  return query;
}

/**
 * ¿Hay algún filtro puesto?
 *
 * **El período por defecto no cuenta**: siempre hay uno, así que si contara, un mes sin cobranza
 * diría «no hay pagos con esos filtros» en vez de «no se cobró nada este mes», que es lo que de
 * verdad pasó — y es una noticia distinta.
 */
export function hasPaymentFilters(params: PaymentParams): boolean {
  return Boolean(params.from || params.to || params.creditId || params.caseId);
}

/** Lo cobrado en lo que se está mirando. Se suma en cliente: no hay endpoint de agregación. */
export function totalOf(payments: PaymentItem[]): number {
  return Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
}

// `isUuid` se mudó a `lib/uuid.ts` cuando apareció su tercer consumidor (el dashboard). Se
// re-exporta para no tocar las tres pantallas de pagos que ya lo importan de acá.
export { isUuid } from './uuid';
