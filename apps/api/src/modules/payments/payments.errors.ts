import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** Monto inválido: ≤ 0 o excede el saldo pendiente. */
export const paymentInvalid = (message: string) =>
  new BadRequestException({ code: 'PAYMENT_001', message });

/** Pago duplicado (Idempotency-Key / external_transaction_id / recibo ya registrado). */
export const paymentDuplicate = () =>
  new ConflictException({ code: 'PAYMENT_DUP', message: 'Pago duplicado (ya registrado)' });

/** El crédito no admite pagos en su estado actual. */
export const creditNotActive = () =>
  new UnprocessableEntityException({ code: 'CREDIT_NOT_ACTIVE', message: 'El crédito no está activo' });

/** La solicitud de pago no está pendiente (ya conciliada / expirada / cancelada). */
export const requestNotPending = () =>
  new ConflictException({ code: 'PAYREQ_STATE', message: 'La solicitud de pago no está pendiente' });
