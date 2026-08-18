import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** El usuario no tiene ninguna capacidad que habilite la acción (ej. un auditor). */
export const routeForbidden = (action: string) =>
  new ForbiddenException({ code: 'AUTH_002', message: `No tenés permiso para ${action}` });

export const invalidCollector = () =>
  new UnprocessableEntityException({ code: 'ROUTE_COLLECTOR', message: 'El cobrador no pertenece al tenant' });

/** El mismo caso ya es una parada de esta ruta (dos toques sobre el mismo pin del mapa). */
export const stopDuplicate = () =>
  new UnprocessableEntityException({ code: 'ROUTE_STOP_DUPLICATE', message: 'Ese cliente ya está en el recorrido' });

/** Una parada ya gestionada es historia de la jornada: no se quita ni se mueve. */
export const stopNotPending = () =>
  new UnprocessableEntityException({ code: 'ROUTE_STOP_DONE', message: 'La parada ya fue gestionada' });

/**
 * Ya hay una ruta de ese cobrador ese día. La jornada de una persona es una sola.
 *
 * El `routeId` va en `details` para que la pantalla pueda abrirla, pero **el mensaje se explica solo**:
 * el móvil sólo propaga `message`, así que si el texto no dice qué pasó, el cobrador ve un error mudo.
 */
export const routeAlreadyForDay = (routeId: string) =>
  new UnprocessableEntityException({
    code: 'ROUTE_DUPLICATE_DAY',
    message: 'Ya tenés una ruta armada para ese día. Actualizá para verla.',
    details: { routeId },
  });

export const noStopsToRoute = () =>
  // El móvil muestra este texto tal cual (sólo propaga `message`): tiene que decirle al cobrador qué hacer.
  new UnprocessableEntityException({
    code: 'ROUTE_EMPTY',
    message: 'No tenés casos abiertos para armar la ruta de hoy',
  });
