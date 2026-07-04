/** Estado de una solicitud de pago (QR / link). */
export enum PaymentRequestStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}
