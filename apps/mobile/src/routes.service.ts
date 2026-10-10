/**
 * Rutas de campo (solo lectura en P1). Thin sobre `apiQuery`; base del resumen de jornada
 * del Home (P1) y de la pantalla de Rutas (P3). Tipos según `routes.serializer.ts`.
 */
import type { MoraCreditListItem, RouteItem, RouteStopItem, RouteStatus, RouteStopStatus } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import { cachedList, cachedOne } from './sync/cached';
import type { LngLat } from './maps/tiles';

/**
 * Los tipos del contrato y el progreso de la ruta viven en `@kobrax/shared` (F9 W6 T1): los
 * consume también el panel web. Se re-exportan para que las pantallas importen de un solo lado.
 */
export type { RouteItem, RouteStopItem } from '@kobrax/shared';
export { routeProgress } from '@kobrax/shared';

export interface ListRoutesParams {
  collectorId?: string;
  status?: RouteStatus;
  date?: string;
}

export function listRoutes(params: ListRoutesParams): Promise<QueryResult<RouteItem[]>> {
  const query = toQuery({ ...params });
  return cachedList<RouteItem>('route', query || 'all', () => apiQuery<RouteItem[]>(`/routes${query}`));
}

export function getRoute(id: string): Promise<QueryResult<RouteItem>> {
  // La ruta con sus paradas es el itinerario del día: es lo que MÁS tiene que estar sin señal.
  return cachedOne<RouteItem>('route', id, () => apiQuery<RouteItem>(`/routes/${id}`));
}

// ── Lifecycle (P3 Rutas) ──────────────────────────────────────────────────────

/** Genera una ruta desde créditos (auto = créditos del cobrador). `POST /routes/generate`. */
export interface GenerateRouteInput {
  /** Del teléfono: reintentar con el mismo id devuelve la ruta ya creada (no una segunda ni ROUTE_DUPLICATE_DAY). */
  id?: string;
  collectorId: string;
  plannedDate: string;
  creditIds?: string[];
  auto?: boolean;
  branchId?: string;
}
export function generateRoute(input: GenerateRouteInput): Promise<MutateResult<RouteItem>> {
  return apiMutate<RouteItem>('/routes/generate', 'POST', input);
}

/** Crea una ruta vacía (paradas aparte). `POST /routes`. */
export interface CreateRouteInput {
  /** Del teléfono: reintentar con el mismo id devuelve la ruta ya creada. */
  id?: string;
  collectorId: string;
  plannedDate: string;
  branchId?: string;
}
export function createRoute(input: CreateRouteInput): Promise<MutateResult<RouteItem>> {
  return apiMutate<RouteItem>('/routes', 'POST', input);
}

/**
 * Cambia el estado de la ruta (PLANNED→IN_PROGRESS→COMPLETED). `PATCH /routes/:id`.
 *
 * `reason` es el motivo de cerrar con paradas sin gestionar (D-5): la API lo exige desde la versión 1.1.0 de la app. Es un
 * valor fijo, así que reenviar el cierre con el mismo motivo es idempotente.
 */
export function updateRouteStatus(id: string, status: RouteStatus, reason?: string): Promise<MutateResult<RouteItem>> {
  return apiMutate<RouteItem>(`/routes/${id}`, 'PATCH', reason ? { status, reason } : { status });
}

/** Agrega una parada al final del recorrido (S2). `POST /routes/:id/stops`. */
export function addStop(routeId: string, input: { clientId: string; creditId: string }): Promise<MutateResult<RouteStopItem>> {
  return apiMutate<RouteStopItem>(`/routes/${routeId}/stops`, 'POST', input);
}

/** Saca una parada del recorrido (S2). `DELETE /routes/:id/stops/:sid`. */
export function removeStop(routeId: string, stopId: string): Promise<MutateResult<null>> {
  return apiMutate<null>(`/routes/${routeId}/stops/${stopId}`, 'DELETE');
}

/** Actualiza una parada (estado y/o orden). `PATCH /routes/:id/stops/:sid`. */
export interface UpdateStopPatch {
  status?: RouteStopStatus;
  sequenceOrder?: number;
}
export function updateStop(routeId: string, stopId: string, patch: UpdateStopPatch): Promise<MutateResult<RouteStopItem>> {
  return apiMutate<RouteStopItem>(`/routes/${routeId}/stops/${stopId}`, 'PATCH', patch);
}

// ── Vista previa y optimización (S3) ─────────────────────────────────────────

export interface RoutePreview {
  /** La polilínea por las calles. **Vacía = hay que unir las paradas con rectas** (sin motor o sin red). */
  geometry: LngLat[];
  distanceKm?: number;
  minutes?: number;
  stops: { id: string; sequenceOrder: number; etaMinutes?: number }[];
  /** Ausente si el orden actual ya está bien, o si no se pudo medir. */
  suggestion?: { order: string[]; savedKm: number; savedMinutes: number };
}

/** El recorrido dibujado, medido y con el orden sugerido (S3). `GET /routes/:id/preview`. */
export function getRoutePreview(routeId: string): Promise<QueryResult<RoutePreview>> {
  return apiQuery<RoutePreview>(`/routes/${routeId}/preview`);
}

/** Aplica el orden sugerido. Devuelve la ruta ya reordenada. `POST /routes/:id/optimize`. */
export function optimizeRoute(routeId: string): Promise<MutateResult<RouteItem>> {
  return apiMutate<RouteItem>(`/routes/${routeId}/optimize`, 'POST', {});
}

// ── Candidatas del planificador (F4/08) ──────────────────────────────────────

/**
 * Los créditos que se pueden poner en la ruta: `GET /mora` (el servidor acota al cobrador). Una fila por
 * crédito, con zona y ubicaciones. Respaldo local propio (`scope`) para armar la ruta sin señal.
 */
export function listRoutePlanCredits(limit = 100): Promise<QueryResult<(MoraCreditListItem & { id: string })[]>> {
  const query = toQuery({ limit });
  return cachedList<MoraCreditListItem & { id: string }>('mora', `route-plan:${query}`, async () => {
    const res = await apiQuery<MoraCreditListItem[]>(`/mora${query}`);
    return res.status === 'ok' ? { ...res, data: res.data.map((i) => ({ ...i, id: i.creditId })) } : res;
  });
}
