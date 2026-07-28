import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

export const invalidCollector = () =>
  new UnprocessableEntityException({ code: 'ROUTE_COLLECTOR', message: 'El cobrador no pertenece al tenant' });

export const noStopsToRoute = () =>
  // El móvil muestra este texto tal cual (sólo propaga `message`): tiene que decirle al cobrador qué hacer.
  new UnprocessableEntityException({
    code: 'ROUTE_EMPTY',
    message: 'No tenés casos abiertos para armar la ruta de hoy',
  });
