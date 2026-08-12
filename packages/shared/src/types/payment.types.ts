/**
 * Contrato de pagos (`/payments`, `/payment-requests`).
 *
 * Vive acá porque lo consumen el móvil y el panel web, y la forma está verificada contra
 * `payments.serializer.ts` de la API.
 *
 * 🔴 **El ledger es INMUTABLE**: `payments` no tiene `update` ni `delete`, y no hay endpoint para
 * corregir ni anular. Un pago mal cargado se arregla con otro asiento. Ninguna pantalla —de
 * ninguna app— ofrece editarlo o borrarlo.
 */
import type { PaymentMethod } from '../constants/kobrax.constants.js';
import type { PaymentRequestStatus } from '../enums/index.js';

export interface PaymentItem {
  id: string;
  creditId: string;
  /** De qué caso es el pago. Lo usa el resumen de la jornada. */
  caseId?: string;
  /** Quién lo registró: `GET /payments` devuelve los del TENANT, no los de un cobrador. */
  registeredBy?: string;
  amount: number;
  method: PaymentMethod;
  provider?: string;
  externalTransactionId?: string;
  receiptNumber?: number;
  /** El comprobante subido. Es la **ruta** que devolvió `uploads`, no un nombre suelto. */
  receiptUrl?: string;
  paymentDate: string;
  createdAt: string;
}

export interface NewPayment {
  creditId: string;
  caseId?: string;
  amount: number;
  method: PaymentMethod;
  receiptUrl?: string;
  receiptHash?: string;
}

/**
 * Un cobro pedido: el QR o el link que se le manda al deudor. `qrPayload` y `url` los arma la API
 * — ni el teléfono ni el panel inventan nada de eso.
 */
export interface PaymentRequestItem {
  id: string;
  creditId?: string;
  clientId?: string;
  caseId?: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentRequestStatus;
  reference?: string;
  qrPayload?: string;
  url?: string;
}
