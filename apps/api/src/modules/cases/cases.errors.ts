import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

/** Recurso inexistente o de otro tenant (genérico, anti-enumeración). */
export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** No se puede cerrar un caso sin al menos una gestión registrada. */
export const caseNoActivity = () =>
  new UnprocessableEntityException({
    code: 'CASE_001',
    message: 'No se puede cerrar un caso sin gestión registrada',
  });

/** Transición de estado no permitida por la máquina de estados. */
export const invalidTransition = (from: string, to: string) =>
  new ConflictException({
    code: 'CASE_002',
    message: `Transición de estado inválida: ${from} → ${to}`,
  });

/** Ya existe un caso abierto para el crédito. */
export const caseDuplicate = () =>
  new ConflictException({ code: 'CASE_DUP', message: 'Ya existe un caso abierto para este crédito' });

/** El colector indicado no pertenece al tenant / no es válido para asignar. */
export const invalidAssignee = () =>
  new UnprocessableEntityException({ code: 'CASE_ASSIGNEE', message: 'No hay un colector válido para asignar' });
