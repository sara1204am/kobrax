import { RouteStatus, RouteStopStatus } from '@kobrax/shared';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * El color del estado de una ruta. **Cancelada no es roja**: no salió mal, no salió. El rojo del
 * panel está reservado para lo que hay que atender.
 */
export const ROUTE_STATUS_TONE: Record<RouteStatus, Tone> = {
  [RouteStatus.PLANNED]: 'neutral',
  [RouteStatus.IN_PROGRESS]: 'warning',
  [RouteStatus.COMPLETED]: 'success',
  [RouteStatus.CANCELLED]: 'neutral',
};

export const STOP_STATUS_TONE: Record<RouteStopStatus, Tone> = {
  [RouteStopStatus.PENDING]: 'neutral',
  [RouteStopStatus.IN_ROUTE]: 'warning',
  [RouteStopStatus.VISITED]: 'success',
  // Salteada no es un error: el cobrador decidió no ir. Pero deja la parada sin gestionar.
  [RouteStopStatus.SKIPPED]: 'warning',
};

/**
 * La query para `GET /routes`.
 *
 * ⚠️ **El listado no trae las paradas** (sólo `GET /routes/:id` las incluye), así que la tabla no
 * puede mostrar avance ni recaudado: `routeProgress` sobre una ruta sin paradas daría «0 de 0»,
 * que es mentira y no un cero. Eso vive en el detalle.
 *
 * Tampoco acepta `?sort=`: ordena por fecha planificada descendente y punto. Por eso ninguna
 * columna es ordenable — una flecha que no ordena nada es peor que no tenerla.
 */
export function routeQuery(
  params: { date?: string; collectorId?: string; status?: string; page?: string },
  limit: number,
): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (params.date) query.set('date', params.date);
  if (params.collectorId) query.set('collectorId', params.collectorId);
  if (params.status) query.set('status', params.status);
  return query;
}

/**
 * ¿Hay algún filtro puesto, además del día?
 *
 * El día **no cuenta**: siempre hay uno, así que si contara, el vacío diría siempre «no hay
 * resultados con esos filtros» en vez de «no hubo rutas ese día», que es lo que de verdad pasó.
 */
export function hasRouteFilters(params: { collectorId?: string; status?: string }): boolean {
  return Boolean(params.collectorId || params.status);
}
