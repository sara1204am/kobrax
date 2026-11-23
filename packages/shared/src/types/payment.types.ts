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

/** El interés moratorio de un crédito a hoy (F17): reproducido de los hechos en la API, nunca calculado en pantalla. */
export interface LateInterestInstallment {
  installmentNumber: number;
  dueDate: string;
  accrued: number;
  collected: number;
  waived: number;
  pending: number;
}

export interface LateInterestView {
  asOf: string;
  accrued: number;
  collected: number;
  waived: number;
  /** Lo que falta cobrar de mora: devengado − cobrado − exonerado. Va APARTE del saldo del plan. */
  pending: number;
  installments: LateInterestInstallment[];
  /** `startsOn`: primer día que corre el devengo si el interés se activó explícitamente en un crédito existente (F3-e); `null` = desde el vencimiento. */
  policy: { annualRate: number; dayCount: 360 | 365; graceDays: number; capPctOfPrincipal: number | null; startsOn?: string | null };
}

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
  /** La visita en la que se cobró (F4/12). Ausente si el cobro no salió de una visita. */
  visitId?: string;
  /**
   * Sólo en el detalle (`GET /payments/:id`) y sólo si hubo visita: quién cobró en ella y a qué parada lleva. `routeId` y
   * `stopId` faltan si la visita no se hizo desde una ruta.
   */
  visit?: { collectorId: string; collectorName?: string; routeId?: string; stopId?: string };
  /** Nombre de quien lo registró (resuelto por el servidor; no exige `user:read`). */
  registeredByName?: string;
  amount: number;
  method: PaymentMethod;
  provider?: string;
  externalTransactionId?: string;
  receiptNumber?: number;
  /** N° del recibo o la factura en papel, tal como lo escribió quien cobró. Distinto de `receiptNumber` (el del sistema). */
  receiptReference?: string;
  /** Desde dónde se registró. Ausente en los anteriores a que se guardara: no se sabe. */
  registeredVia?: 'WEB' | 'MOBILE';
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
  /** N° del recibo o la factura que se entregó (opcional, hasta 40 caracteres). */
  receiptReference?: string;
  /** Desde dónde se registra. El panel manda `WEB`; la app móvil se reconoce por su cabecera. */
  registeredVia?: 'WEB' | 'MOBILE';
  /** La visita en la que se cobró (vincula el pago con la gestión de la parada). Debe ser del mismo crédito. */
  visitId?: string;
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
  /** ISO. Pasada esa hora la solicitud sigue `PENDING` y se puede confirmar: el deudor puede pagar tarde. */
  expiresAt?: string;
  paidPaymentId?: string;
  createdAt?: string;
  /** Quién pidió el cobro, y su nombre (lo resuelve el servidor; no exige `user:read`). */
  createdBy?: string;
  createdByName?: string;
  /** Código del crédito y nombre del deudor, resueltos por el servidor para la bandeja. */
  creditCode?: string;
  clientName?: string;
}

/** A qué cuotas se aplicó un pago (imputación FIFO) y cómo quedó el plan después de él. Viene de `payment_applications`. */
export interface PaymentImputation {
  allocations: { installmentNumber: number; amount: number; /** ¿la cuota quedó cubierta del todo con este pago? */ coversInstallment: boolean }[];
  applied: number;
  /** Lo que no cupo en el plan. */
  unapplied: number;
  /** Lo que quedaba por pagar del plan después de este pago. */
  balanceAfter: number;
  /** Pago anterior a que existieran las aplicaciones: no se inventa un reparto. */
  unrecorded: boolean;
}

/** Un pago del historial de UN crédito (`GET /credits/:id/payments`). `REGISTERED` es el único estado: todavía no hay anulación. */
export interface CreditPaymentItem extends PaymentItem {
  status: 'REGISTERED';
  /** Cuándo se registró en el sistema (la fecha efectiva del cobro es `paymentDate`). */
  registeredAt: string;
  imputation?: PaymentImputation;
}

export interface CreditPaymentsView {
  creditId: string;
  code?: string;
  clientId: string;
  currency: string;
  /** `null` = sin plan (préstamo abierto) o una operación de una fuente externa. */
  plan: {
    planTotal: number;
    prepaidAmount: number;
    collectedAmount: number;
    balance: number;
    overdueAmount: number;
    situation: 'CURRENT' | 'OVERDUE' | 'PAID';
    nextPayment: { number: number; dueDate: string; amount: number; overdue: boolean } | null;
  } | null;
  /** Interés moratorio del crédito. `null`/ausente = no devenga (la cuenta lo tenía apagado cuando nació). */
  lateInterest?: LateInterestView | null;
  /** Del más reciente al más antiguo. */
  payments: CreditPaymentItem[];
}

/**
 * Hasta cuántos días atrás puede fecharse un cobro. Cubre al cobrador que pasa una semana sin señal y sincroniza al volver; más atrás ya no
 * es un pago offline, es una corrección de historia. Lo valida la API y lo respeta el formulario del panel (el campo de fecha).
 */
export const PAYMENT_BACKDATE_DAYS = 30;

