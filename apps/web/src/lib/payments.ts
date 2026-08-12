import { PAYMENT_METHODS, type PaymentItem } from '@kobrax/shared';

/**
 * El período que se está mirando, en `YYYY-MM-DD`. Por defecto, el mes corriente: un ledger se lee
 * por período, no por día — al revés que la agenda o las rutas, que son de una jornada.
 */
export function defaultPeriod(today = new Date()): { from: string; to: string } {
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: first.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La query para `GET /payments`.
 *
 * 🔴 **`to` viaja con el final del día.** `paymentDate` es un timestamp, así que mandando la fecha
 * pelada el límite queda en medianoche y **los pagos de ese día no entran**: es exactamente el
 * defecto que W6 tuvo en el «recaudado» de una ruta, donde daba siempre cero. El móvil ya lo hacía
 * bien; acá se hereda.
 */
export function paymentQuery(
  params: { from?: string; to?: string; creditId?: string; caseId?: string; page?: string },
  limit: number,
  today = new Date(),
): URLSearchParams {
  const period = defaultPeriod(today);
  const from = params.from && IS_DAY.test(params.from) ? params.from : period.from;
  const to = params.to && IS_DAY.test(params.to) ? params.to : period.to;

  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ from, to: `${to}T23:59:59.999Z`, page: String(page), limit: String(limit) });
  if (params.creditId) query.set('creditId', params.creditId);
  if (params.caseId) query.set('caseId', params.caseId);
  return query;
}

/** Lo cobrado en lo que se está mirando. Se suma en cliente: no hay endpoint de agregación. */
export function totalOf(payments: PaymentItem[]): number {
  return Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
}

/** ¿El medio que viene de la URL o de un formulario es uno de los que la API acepta? */
export function isPaymentMethod(value: string): boolean {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}
