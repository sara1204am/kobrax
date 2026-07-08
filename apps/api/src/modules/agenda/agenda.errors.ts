import { NotFoundException } from '@nestjs/common';

export const agendaItemNotFound = () =>
  new NotFoundException({ code: 'AGENDA_NOT_FOUND', message: 'Gestión agendada no encontrada' });
