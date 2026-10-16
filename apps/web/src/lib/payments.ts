import { isCreditSource, PAYMENT_METHODS, type PaymentItem } from '@kobrax/shared';
import { DISPLAY_TIME_ZONE } from './format';
import { PAGE_SIZES } from './table-prefs';
import { isUuid } from './uuid';

/**
 * El período que se está mirando, en `YYYY-MM-DD`. Por defecto, el mes corriente: un ledger se lee
 * por período, no por día — al revés que la agenda o las rutas, que son de una jornada.
 *
 * 🔴 **«Hoy» es el de la empresa, no el de UTC.** Con la fecha UTC, de las 20:00 a las 24:00 en Bolivia el período por
 * defecto terminaba "mañana" y no coincidía con «Cobrado hoy», que sí es del día civil de la empresa.
 */
export function defaultPeriod(today = new Date()): { from: string; to: string } {
  const to = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(today);
  return { from: `${to.slice(0, 7)}-01`, to };
}

const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Los valores de un filtro de varios (`a,b,c`) sin vacíos ni repetidos. */
const csvOf = (value?: string): string[] => [...new Set((value ?? '').split(',').map((v) => v.trim()).filter(Boolean))];

/** Lo que la pantalla de Pagos sabe leer de la URL. Las claves son las que escribe el `DataTable`. */
export interface PaymentParams {
  from?: string;
  to?: string;
  /** Llega por link desde la ficha del crédito; no se escribe a mano. */
  creditId?: string;
  /** D7: `KOBRAX` o una fuente externa. */
  source?: string;
  /** Quién registró el cobro: uno o varios uuid de usuario, separados por coma. */
  registeredBy?: string;
  /** Medio de pago: uno o varios (`CASH,QR`), separados por coma. */
  method?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
  dir?: string;
}

/**
 * La columna que toca el `DataTable` → el campo que la API sabe ordenar.
 *
 * 🔴 **La traducción existe para que la URL siga hablando el idioma de la pantalla** y, sobre todo,
 * para que sólo viaje lo que el DTO acepta: una clave de más —una preferencia vieja, alguien
 * probando— sería un 400 y el ledger entero se vaciaría.
 *
 * ⚠️ **«Registró» no está.** Es un uuid de usuario, no un nombre: ordenar por él agrupa los pagos de
 * cada persona pero deja los grupos en un orden que no es el de ningún nombre, y la tabla se leería
 * como rota. El día que haga falta, se resuelve en dos pasos como las rutas por cobrador.
 */
const SORTS: Record<string, string> = {
  date: 'paymentDate',
  amount: 'amount',
  method: 'method',
  receipt: 'receiptNumber',
};

/** El rango que de verdad se pide: el de la URL si es válido, y si no el mes corriente. Lo usan la consulta y la tarjeta del período. */
export function effectivePeriod(params: PaymentParams, today = new Date()): { from: string; to: string } {
  const period = defaultPeriod(today);
  return {
    from: params.from && IS_DAY.test(params.from) ? params.from : period.from,
    to: params.to && IS_DAY.test(params.to) ? params.to : period.to,
  };
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
  const { from, to } = effectivePeriod(params, today);

  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({
    from,
    to: `${to}T23:59:59.999Z`,
    page: String(page),
    limit: String(paymentLimit(params)),
  });
  if (params.creditId && isUuid(params.creditId)) query.set('creditId', params.creditId);
  if (isCreditSource(params.source)) query.set('source', params.source);
  // Un valor que no es uuid, o un medio inventado, es un 400 del DTO y dejaría el ledger vacío: viaja sólo lo válido.
  const officers = csvOf(params.registeredBy).filter(isUuid);
  if (officers.length > 0) query.set('registeredBy', officers.join(','));
  const methods = csvOf(params.method).filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m));
  if (methods.length > 0) query.set('method', methods.join(','));
  // Las tarjetas de arriba (hoy y este mes) las suma la API aparte del total del filtro.
  query.set('summary', '1');

  // Sin orden pedido no se manda ninguno: el default —lo último cobrado primero— lo pone la API, y
  // repetirlo acá serían dos lugares donde cambiarlo.
  const sort = params.sort ? SORTS[params.sort] : undefined;
  if (sort) {
    query.set('sort', sort);
    query.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  }
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
  return Boolean(params.from || params.to || params.creditId || params.source || params.registeredBy || params.method);
}

/** Lo cobrado en lo que se está mirando. Se suma en cliente: no hay endpoint de agregación. */
export function totalOf(payments: PaymentItem[]): number {
  return Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
}

// `isUuid` se mudó a `lib/uuid.ts` cuando apareció su tercer consumidor (el dashboard). Se
// re-exporta para no tocar las tres pantallas de pagos que ya lo importan de acá.
export { isUuid } from './uuid';

/** Lo que la bandeja de cobros pedidos sabe leer de la URL. */
export interface RequestParams {
  /** `PENDING` (por confirmar) si no dice otra cosa; `ALL` los trae todos. */
  status?: string;
  page?: string;
  pageSize?: string;
}

const REQUEST_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'] as const;

/** El estado que se está mirando. La bandeja abre en lo que falta confirmar, que es para lo que existe. */
export function requestStatus(params: RequestParams): (typeof REQUEST_STATUSES)[number] | 'ALL' {
  if (params.status === 'ALL') return 'ALL';
  return REQUEST_STATUSES.find((s) => s === params.status) ?? 'PENDING';
}

/** La query para `GET /payment-requests`. Sólo viaja lo que el DTO acepta: un valor de más es un 400. */
export function requestQuery(params: RequestParams): URLSearchParams {
  const query = new URLSearchParams({
    page: String(Math.max(1, Number(params.page) || 1)),
    limit: String(paymentLimit(params)),
  });
  const status = requestStatus(params);
  if (status !== 'ALL') query.set('status', status);
  return query;
}

/** ¿Venció? Sigue `PENDING` y se puede confirmar: el deudor puede pagar pasadas las 24 h. */
export function isRequestExpired(r: { status: string; expiresAt?: string }, now = new Date()): boolean {
  return r.status === 'PENDING' && !!r.expiresAt && new Date(r.expiresAt).getTime() < now.getTime();
}
