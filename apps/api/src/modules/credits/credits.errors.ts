import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

/** Recurso inexistente o de otro tenant (genérico, anti-enumeración). */
export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** El cronograma generado no cumple la invariante de suma. */
export const scheduleInvalid = () =>
  new BadRequestException({
    code: 'SCHEDULE_INVALID',
    message: 'El cronograma generado no cuadra (Σ cuotas ≠ principal + interés)',
  });

/** Moneda del crédito incoherente con la del tenant. */
export const currencyMismatch = (expected: string) =>
  new BadRequestException({
    code: 'CREDIT_CURRENCY',
    message: `La moneda del crédito debe ser ${expected} (la del tenant)`,
  });

/** Operación no aplicable al estado actual del crédito. */
export const creditNotActive = () =>
  new UnprocessableEntityException({
    code: 'CREDIT_NOT_ACTIVE',
    message: 'El crédito no está activo',
  });

/** Datos financieros bloqueados: crédito importado (§4.3), su fuente es el archivo. */
export const creditLocked = () =>
  new UnprocessableEntityException({
    code: 'CREDIT_LOCKED',
    message: 'Los datos financieros de un crédito importado no se editan; actualizá con una nueva importación',
  });
