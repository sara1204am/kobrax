import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const agendaItemNotFound = () =>
  new NotFoundException({ code: 'AGENDA_NOT_FOUND', message: 'Gestión agendada no encontrada' });

/** El crédito no existe o quien agenda no lo puede ver. Se responde 404 (no 403): no filtra existencia. */
export const agendaCreditNotFound = () =>
  new NotFoundException({ code: 'AGENDA_001', message: 'El crédito no existe o no está a tu cargo' });

/** El cliente existe, pero ninguno de sus créditos es visible para quien agenda → no puede agendarle nada. */
export const agendaClientWithoutCredits = () =>
  new NotFoundException({ code: 'AGENDA_002', message: 'El cliente no tiene créditos a tu cargo' });

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

/** El `id` que mandó el cliente ya es de otra gestión (otro crédito, o una eliminada). */
export const agendaIdTaken = () =>
  new ConflictException({ code: 'AGENDA_009', message: 'Ese id de gestión ya pertenece a otra gestión agendada' });

/** Un cobrador (sin `agenda:assign`) intentó agendarle una gestión a otra persona. */
export const agendaAssignForbidden = () =>
  new ForbiddenException({ code: 'AGENDA_010', message: 'No puedes asignar gestiones a otras personas' });

/** El destinatario no existe, está inactivo, no es cobrador/supervisor o es de otra agencia. 400, no 404: quien pide ya tiene permiso de asignar. */
export const agendaAssigneeNotEligible = () =>
  new BadRequestException({ code: 'AGENDA_011', message: 'Esa persona no puede recibir gestiones: debe ser un cobrador o supervisor activo de tu alcance' });

/** Editar y eliminar son de quien creó la gestión: ni el responsable ni un administrador la tocan. */
export const agendaNotOwner = () =>
  new ForbiddenException({ code: 'AGENDA_012', message: 'Solo quien creó la gestión puede editarla o eliminarla' });

/** Toda visita lleva la ubicación del domicilio: sin dirección con punto en el mapa no se puede ir ni planificar una ruta. */
export const agendaVisitNeedsLocation = () =>
  new BadRequestException({ code: 'AGENDA_013', message: 'La visita necesita una dirección del cliente con ubicación en el mapa' });

/** La visita ya está en una ruta: se registra desde la parada (con GPS y evidencia), no desde la agenda. */
export const agendaVisitInRoute = () =>
  new ConflictException({ code: 'AGENDA_014', message: 'Esta visita está en una ruta: regístrala desde la parada' });
