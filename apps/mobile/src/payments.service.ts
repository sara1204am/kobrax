/**
 * Pagos (lectura + registro). El registro descuenta el saldo y avanza la próxima fecha en el server
 * (fundación); acá solo se dispara con `Idempotency-Key` para que un reintento no duplique el cobro.
 */
// Se importan además de re-exportarse: un `export ... from` no trae los nombres al scope local.
import type { NewPayment, PaymentItem } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import { cachedList } from './sync/cached';

/**
 * El contrato de pagos vive en `@kobrax/shared` (F9 W7 T0), y con él **el `PaymentMethod` bueno**:
 * hasta ahora el de `shared` era minúscula legacy y esta app se había escrito su propia copia al
 * lado. Se arregló allá, así que la copia se va y queda una sola verdad.
 */
export type { NewPayment, PaymentItem, PaymentMethod } from '@kobrax/shared';

export function listPayments(caseId: string): Promise<QueryResult<PaymentItem[]>> {
  const query = toQuery({ caseId, limit: 100 });
  return cachedList<PaymentItem>('payment', query, () => apiQuery<PaymentItem[]>(`/payments${query}`));
}

/**
 * Los pagos de un día (Rutas S6). Devuelve los de **todo el tenant**: acotarlos a la ruta —y al
 * cobrador— es responsabilidad de quien llama, porque el KPI se calcula en el cliente
 * (`ui-screen-map §8.1`). `summarizeDay` es quien lo hace.
 */
export function listPaymentsByDay(day: string): Promise<QueryResult<PaymentItem[]>> {
  const query = toQuery({ from: day, to: `${day}T23:59:59.999Z`, limit: 100 });
  // Con respaldo local: sin esto, el cierre de jornada sin señal anunciaba "TOTAL RECAUDADO HOY
  // Bs 0,00" — que es mentira, el cobrador sí cobró — en vez de admitir que no pudo leerlo.
  return cachedList<PaymentItem>('payment', query, () => apiQuery<PaymentItem[]>(`/payments${query}`));
}

/** Registra el pago. `idempotencyKey` (generado en el cliente) evita el doble cobro ante reintento. */
export function createPayment(input: NewPayment, idempotencyKey: string): Promise<MutateResult<PaymentItem>> {
  return apiMutate<PaymentItem>('/payments', 'POST', input, { 'idempotency-key': idempotencyKey });
}
