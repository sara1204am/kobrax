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

// ── Condiciones del crédito (F4/06 · D14) ─────────────────────────────────────

/** Las condiciones no tienen forma válida, o el motor no puede calcularlas (`issues` dice por qué). */
export const creditTermsInvalid = (issues: string[]) =>
  new BadRequestException({
    code: 'CREDIT_TERMS_INVALID',
    message: 'Las condiciones del crédito no son válidas',
    details: { issues },
  });

/** Un campo suelto del alta contradice a las condiciones: no se elige uno, se rechaza. */
export const creditTermsConflict = (field: string) =>
  new BadRequestException({
    code: 'CREDIT_TERMS_CONFLICT',
    message: `El campo ${field} no coincide con las condiciones del crédito`,
    details: { field },
  });

/** La cuota enviada no es la del acuerdo ni la del motor (ni siquiera por redondeo). */
export const creditInstallmentMismatch = (expected: number, sent: number) =>
  new BadRequestException({
    code: 'CREDIT_INSTALLMENT_MISMATCH',
    message: `La cuota enviada (${sent}) no coincide con la de las condiciones (${expected})`,
    details: { expected, sent },
  });

/** Cuotas que varían (capital fijo): se cobran bien recién cuando se guarde el cronograma real (F4/06 · Fase 6). */
export const creditTermsNotPersistable = () =>
  new UnprocessableEntityException({
    code: 'CREDIT_TERMS_NOT_PERSISTABLE',
    message: 'Un crédito con cuotas que varían (capital fijo) todavía no se puede registrar',
  });

/** Editar los datos financieros de un crédito con condiciones: llega con la edición de F4/06 · Fase 3. */
export const creditTermsEditUnsupported = () =>
  new UnprocessableEntityException({
    code: 'CREDIT_TERMS_EDIT_UNSUPPORTED',
    message: 'Los datos financieros de un crédito con condiciones todavía no se editan desde acá',
  });

/**
 * Poner al día con una fecha que ya pasó.
 *
 * No es una formalidad: con una fecha vencida el crédito queda en mora igual, el trabajo diario le
 * vuelve a abrir el caso esta misma noche, y quien lo puso al día ve reaparecer lo que creyó haber
 * resuelto. Es exactamente el ciclo que el módulo existe para evitar.
 */
export const arrearsDateNotFuture = () =>
  new UnprocessableEntityException({
    code: 'ARREARS_DATE_PAST',
    message: 'La nueva fecha de vencimiento tiene que ser futura, o el crédito vuelve a quedar en mora',
  });
