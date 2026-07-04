import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

export const invalidCollector = () =>
  new UnprocessableEntityException({ code: 'ROUTE_COLLECTOR', message: 'El cobrador no pertenece al tenant' });

export const noStopsToRoute = () =>
  new UnprocessableEntityException({ code: 'ROUTE_EMPTY', message: 'No hay casos/paradas para la ruta' });
