/**
 * Pagos (lectura + registro). El registro descuenta el saldo y avanza la próxima fecha en el server
 * (fundación); acá solo se dispara con `Idempotency-Key` para que un reintento no duplique el cobro.
 */
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import { cachedList } from './sync/cached';

/** Valores del enum `PaymentMethod` de la API (Prisma, MAYÚSCULA — el `PaymentMethod` de shared es otro,
 * minúscula y legacy; no sirve para el payload). */
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'QR' | 'CARD' | 'MOBILE_PAYMENT';

export interface PaymentItem {
  id: string;
  creditId: string;
  /** De qué caso es el pago. El server ya lo mandaba; lo usa el resumen de jornada (Rutas S6). */
  caseId?: string;
  /** Quién lo registró: `GET /payments` devuelve los del tenant, no los de un cobrador. */
  registeredBy?: string;
  amount: number;
  method: PaymentMethod;
  receiptUrl?: string;
  paymentDate: string;
  createdAt: string;
}

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

export interface NewPayment {
  creditId: string;
  caseId?: string;
  amount: number;
  method: PaymentMethod;
  receiptUrl?: string;
  receiptHash?: string;
}

/** Registra el pago. `idempotencyKey` (generado en el cliente) evita el doble cobro ante reintento. */
export function createPayment(input: NewPayment, idempotencyKey: string): Promise<MutateResult<PaymentItem>> {
  return apiMutate<PaymentItem>('/payments', 'POST', input, { 'idempotency-key': idempotencyKey });
}
