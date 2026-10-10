import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

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

/** El `id` de la ruta que mandó el cliente ya es de la ruta de otro cobrador. */
export const routeIdTaken = () =>
  new ConflictException({ code: 'ROUTE_ID', message: 'Ese id de ruta ya pertenece a otra ruta' });

// ── F4/12 · ciclo de vida, autoría y pedidos de cambio ───────────────────────────────────────────────

/** Ese cambio de estado no existe: una ruta cerrada no se reabre y no se completa lo que nunca se inició. */
export const routeTransition = (from: string, to: string) =>
  new UnprocessableEntityException({
    code: 'ROUTE_TRANSITION',
    message: `La ruta está ${STATE_LABEL[from] ?? from}: no puede pasar a ${STATE_LABEL[to] ?? to}.`,
    details: { from, to },
  });

const STATE_LABEL: Record<string, string> = {
  PLANNED: 'planificada',
  IN_PROGRESS: 'en curso',
  COMPLETED: 'completada',
  CANCELLED: 'cancelada',
};

/** Alguien cambió la ruta entre que la pantalla la leyó y este cambio: se vuelve a leer, no se pisa. */
export const routeStateChanged = () =>
  new ConflictException({ code: 'ROUTE_STATE_CHANGED', message: 'La ruta cambió mientras la mirabas. Actualizá y volvé a intentar.' });

/** La ruta ya se cerró (completada o cancelada): sus paradas son historia. */
export const routeClosed = () =>
  new UnprocessableEntityException({ code: 'ROUTE_CLOSED', message: 'La ruta ya está cerrada: no se puede modificar.' });

/** Cerrar con paradas sin gestionar, o cancelar, exige decir por qué. */
export const reasonRequired = (what: string) =>
  new UnprocessableEntityException({
    code: 'ROUTE_REASON_REQUIRED',
    message: `Escribí el motivo ${what} (al menos unas palabras).`,
  });

/** Con visitas registradas no se cancela: esa información no se borra, se cierra la ruta. */
export const routeHasVisits = () =>
  new UnprocessableEntityException({
    code: 'ROUTE_HAS_VISITS',
    message: 'La ruta ya tiene visitas registradas: no se cancela, se completa. Indicá el motivo de las paradas que quedaron.',
  });

/** Quien no armó la ruta no la modifica directo: la pide. */
export const changeRequestRequired = (kind: string) =>
  new ForbiddenException({
    code: 'ROUTE_REQUEST_REQUIRED',
    message: 'Esta ruta la armó otra persona: pedí el cambio con su motivo y ella lo aprueba.',
    details: { kind },
  });

/** La parada se marca visitada registrando la visita, no a secas. */
export const stopStatusNotAllowed = (from: string, to: string) =>
  new UnprocessableEntityException({
    code: 'ROUTE_STOP_TRANSITION',
    message:
      to === 'VISITED'
        ? 'Para marcar la parada como visitada registrá la visita: eso guarda el resultado y cierra la gestión.'
        : `La parada está ${from === 'VISITED' ? 'visitada' : from === 'SKIPPED' ? 'saltada' : 'en ese estado'} y no puede pasar a ese estado.`,
    details: { from, to },
  });

/** Fechas de ruta: solo el día, `YYYY-MM-DD`. */
export const routePastDate = () =>
  new UnprocessableEntityException({ code: 'ROUTE_PAST_DATE', message: 'No se arma una ruta para un día que ya pasó.' });

/** Planificar sin límite hacia adelante convierte la ruta en una lista de deseos: se acota (D-6). */
export const routeTooFar = (maxDays: number) =>
  new UnprocessableEntityException({
    code: 'ROUTE_TOO_FAR',
    message: `Solo se arma una ruta hasta ${maxDays} días hacia adelante.`,
    details: { maxDays },
  });

export const changeRequestNotFound = () =>
  new NotFoundException({ code: 'ROUTE_REQUEST_NOT_FOUND', message: 'Ese pedido de cambio no existe.' });

export const changeRequestResolved = () =>
  new ConflictException({ code: 'ROUTE_REQUEST_RESOLVED', message: 'Ese pedido ya fue resuelto.' });

/** Solo quien manda sobre la ruta resuelve los pedidos; quien lo pidió solo puede retirarlo. */
export const cannotDecide = () =>
  new ForbiddenException({ code: 'ROUTE_REQUEST_FORBIDDEN', message: 'Solo quien armó la ruta resuelve los pedidos de cambio.' });

/** El pedido aprobado ya no se puede aplicar (la parada se gestionó, la ruta se cerró…). */
export const changeRequestStale = (why: string) =>
  new UnprocessableEntityException({ code: 'ROUTE_REQUEST_STALE', message: `No se puede aplicar el cambio: ${why}` });

/** Para publicar, cada parada necesita un punto en el mapa: sin él no hay recorrido ni ETA (decisión 6). */
export const stopsWithoutPoint = (creditIds: string[]) =>
  new UnprocessableEntityException({
    code: 'ROUTE_STOP_NO_POINT',
    message: 'Falta la ubicación de algunas paradas: marcá el punto en el mapa antes de armar la ruta.',
    details: { creditIds },
  });
