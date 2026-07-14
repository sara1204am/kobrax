/**
 * Pagos (lectura + registro). El registro descuenta el saldo y avanza la próxima fecha en el server
 * (fundación); acá solo se dispara con `Idempotency-Key` para que un reintento no duplique el cobro.
 */
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';

/** Valores del enum `PaymentMethod` de la API (Prisma, MAYÚSCULA — el `PaymentMethod` de shared es otro,
 * minúscula y legacy; no sirve para el payload). */
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'QR' | 'CARD' | 'MOBILE_PAYMENT';

export interface PaymentItem {
  id: string;
  creditId: string;
  amount: number;
  method: PaymentMethod;
  receiptUrl?: string;
  paymentDate: string;
  createdAt: string;
}

export function listPayments(caseId: string): Promise<QueryResult<PaymentItem[]>> {
  return apiQuery<PaymentItem[]>(`/payments${toQuery({ caseId, limit: 100 })}`);
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
