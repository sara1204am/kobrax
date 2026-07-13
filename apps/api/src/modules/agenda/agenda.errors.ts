import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export const agendaItemNotFound = () =>
  new NotFoundException({ code: 'AGENDA_NOT_FOUND', message: 'Gestión agendada no encontrada' });

/** El caso no existe, está cerrado, o no está asignado a quien agenda. Se responde 404 (no 403): no filtra existencia. */
export const agendaCaseNotFound = () =>
  new NotFoundException({ code: 'AGENDA_001', message: 'El caso no existe o no está asignado a vos' });

/** El cliente existe, pero ninguno de sus casos abiertos es del cobrador → no puede agendarle nada. */
export const agendaClientWithoutCases = () =>
  new NotFoundException({ code: 'AGENDA_002', message: 'El cliente no tiene casos asignados a vos' });

export const agendaPastDate = () =>
  new BadRequestException({ code: 'AGENDA_003', message: 'No se puede agendar en una fecha pasada' });

export const agendaInvalidTimeMode = (message: string) =>
  new BadRequestException({ code: 'AGENDA_004', message });

/** `details` no cumple las reglas del tipo (validador puro de `@kobrax/shared`). */
export const agendaInvalidDetails = (errors: string[]) =>
  new BadRequestException({ code: 'AGENDA_005', message: 'Los datos de la gestión no son válidos', details: { errors } });

/** El `details` es válido en forma, pero no cierra contra la DB (contacto ajeno, monto > saldo, etc.). */
export const agendaInvalidReference = (message: string) =>
  new BadRequestException({ code: 'AGENDA_006', message });

/** El desenlace elegido no corresponde al tipo de gestión (p.ej. "pagó" en una llamada). */
export const agendaInvalidOutcome = () =>
  new BadRequestException({ code: 'AGENDA_007', message: 'El resultado no corresponde al tipo de gestión' });

/** La gestión ya fue ejecutada (o cancelada): no se puede volver a registrar ni posponer. */
export const agendaNotSchedulable = () =>
  new ConflictException({ code: 'AGENDA_008', message: 'La gestión ya no está pendiente' });
