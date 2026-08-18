import { RouteStatus, RouteStopStatus, type ResultCategory } from '@kobrax/shared';
import { PAGE_SIZES } from './table-prefs';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * El color de cada categoría del resumen. Es el mismo mapa que el móvil, pero **no se promueve**:
 * un color es presentación, y cada app tiene su paleta. Lo que sí se comparte es `categoryOf`, que
 * decide en qué categoría cae cada resultado.
 */
export const CATEGORY_TONE: Record<ResultCategory, Tone> = {
  COLLECTED: 'success',
  PROMISED: 'warning',
  NO_ANSWER: 'danger',
  UNREACHABLE: 'neutral',
  OTHER: 'neutral',
};

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

/** Lo que la pantalla de Rutas sabe leer de la URL. Las claves son las que escribe el `DataTable`. */
export interface RouteParams {
  date?: string;
  collectorId?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}

/** Cuántas rutas por página si nadie eligió otra cosa. Un día tiene una ruta por cobrador. */
export const DEFAULT_PAGE_SIZE = 25;

/** El tamaño de página pedido, o el default. Un valor inventado es un 400 de la API, no una opción. */
export function routeLimit(params: RouteParams): number {
  return PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : DEFAULT_PAGE_SIZE;
}

/**
 * La query para `GET /routes`.
 *
 * ⚠️ **El listado no trae las paradas** (sólo `GET /routes/:id` las incluye), así que la tabla no
 * puede mostrar avance ni recaudado: `routeProgress` sobre una ruta sin paradas daría «0 de 0»,
 * que es mentira y no un cero. Eso vive en el detalle.
 *
 * Tampoco acepta `?sort=`: ordena por fecha planificada descendente y punto. Por eso ninguna
 * columna es ordenable — una flecha que no ordena nada es peor que no tenerla.
 *
 * 🔴 **`status` y `collectorId` se validan antes de viajar**: el DTO de la API los valida como enum
 * y como uuid, y un valor inventado en la URL —o una preferencia guardada de cuando el cobrador
 * todavía estaba activo— devolvería 400 y dejaría la pantalla entera sin rutas.
 */
export function routeQuery(params: RouteParams): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ page: String(page), limit: String(routeLimit(params)) });
  if (params.date) query.set('date', params.date);
  if (params.collectorId && IS_UUID.test(params.collectorId)) query.set('collectorId', params.collectorId);
  if (params.status && params.status in ROUTE_STATUS_TONE) query.set('status', params.status);
  return query;
}

const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Hay algún filtro puesto, además del día?
 *
 * El día **no cuenta**: siempre hay uno, así que si contara, el vacío diría siempre «no hay
 * resultados con esos filtros» en vez de «no hubo rutas ese día», que es lo que de verdad pasó.
 */
export function hasRouteFilters(params: RouteParams): boolean {
  return Boolean(params.collectorId || params.status);
}
