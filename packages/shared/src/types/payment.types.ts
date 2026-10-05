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

/**
 * Quién recibió la plata (D3). `PaymentMethod` es el medio; esto es el canal: la cobró Kobrax, o el
 * deudor pagó por un canal de la entidad y el cobrador lo confirmó. Los dos cuentan como recuperado.
 */
export const PAYMENT_CHANNELS = ['KOBRAX_COLLECTED', 'EXTERNAL_CONFIRMED'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export interface PaymentItem {
  id: string;
  creditId: string;
  /** Quién lo registró: `GET /payments` devuelve los del TENANT, no los de un cobrador. */
  registeredBy?: string;
  amount: number;
  method: PaymentMethod;
  provider?: string;
  externalTransactionId?: string;
  receiptNumber?: number;
  /** El comprobante subido. Es la **ruta** que devolvió `uploads`, no un nombre suelto. */
  receiptUrl?: string;
  /** Cuándo se cobró. En un pago registrado offline es la hora del teléfono, no la de la sincronización. */
  paymentDate: string;
  channel?: PaymentChannel;
  notes?: string;
  createdAt: string;
  /** Fuente externa del crédito al que se imputó (D7). Ausente = crédito de Kobrax. Sólo en el listado. */
  creditSource?: string;
}

export interface NewPayment {
  creditId: string;
  amount: number;
  method: PaymentMethod;
  receiptUrl?: string;
  receiptHash?: string;
  /** Default `KOBRAX_COLLECTED`. */
  channel?: PaymentChannel;
  notes?: string;
  /**
   * ISO. Cuándo se cobró, si no es «ahora»: el pago guardado sin señal viaja con la hora en que se cobró,
   * no con la de la sincronización (si no, el historial ordena al revés el cobro y la ausencia del reporte).
   */
  paymentDate?: string;
}

/**
 * Un cobro pedido: el QR o el link que se le manda al deudor. `qrPayload` y `url` los arma la API
 * — ni el teléfono ni el panel inventan nada de eso.
 */
export interface PaymentRequestItem {
  id: string;
  creditId?: string;
  clientId?: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentRequestStatus;
  reference?: string;
  qrPayload?: string;
  url?: string;
}
