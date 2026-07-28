/**
 * Rutas de campo (solo lectura en P1). Thin sobre `apiQuery`; base del resumen de jornada
 * del Home (P1) y de la pantalla de Rutas (P3). Tipos según `routes.serializer.ts`.
 */
import { RouteStopStatus, type RouteStatus } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import type { LngLat } from './maps/tiles';

export interface RouteStopItem {
  id: string;
  clientId: string;
  caseId?: string;
  sequenceOrder: number;
  status: RouteStopStatus;
  visitedAt?: string;
  /** Sólo en `GET /routes/:id`: el listado no trae paradas, y generar tampoco las enriquece. */
  clientName?: string;
  /** Dirección donde se cobra (HOME, si no la primera cargada). Vacía si el cliente no tiene ninguna. */
  address?: string;
}

export interface RouteItem {
  id: string;
  collectorId: string;
  branchId?: string;
  plannedDate: string;
  status: RouteStatus;
  totalCases: number;
  totalDistanceKm?: number;
  estimatedMinutes?: number;
  createdAt: string;
  stops?: RouteStopItem[];
}

/** Estados terminales de una parada = "gestión hecha" (visitada o descartada). */
const STOP_DONE: RouteStopStatus[] = [RouteStopStatus.VISITED, RouteStopStatus.SKIPPED];

/** Progreso de la ruta: paradas resueltas / total. */
export function routeProgress(route: RouteItem): { done: number; total: number } {
  const stops = route.stops ?? [];
  return { done: stops.filter((s) => STOP_DONE.includes(s.status)).length, total: stops.length };
}

export interface ListRoutesParams {
  collectorId?: string;
  status?: RouteStatus;
  date?: string;
}

export function listRoutes(params: ListRoutesParams): Promise<QueryResult<RouteItem[]>> {
  return apiQuery<RouteItem[]>(`/routes${toQuery({ ...params })}`);
}

export function getRoute(id: string): Promise<QueryResult<RouteItem>> {
  return apiQuery<RouteItem>(`/routes/${id}`);
}

// ── Lifecycle (P3 Rutas) ──────────────────────────────────────────────────────

/** Genera una ruta desde casos (auto = casos abiertos del cobrador). `POST /routes/generate`. */
export interface GenerateRouteInput {
  collectorId: string;
  plannedDate: string;
  caseIds?: string[];
  auto?: boolean;
  branchId?: string;
}
export function generateRoute(input: GenerateRouteInput): Promise<MutateResult<RouteItem>> {
  return apiMutate<RouteItem>('/routes/generate', 'POST', input);
}

/** Crea una ruta vacía (paradas aparte). `POST /routes`. */
export interface CreateRouteInput {
  collectorId: string;
  plannedDate: string;
  branchId?: string;
}
export function createRoute(input: CreateRouteInput): Promise<MutateResult<RouteItem>> {
  return apiMutate<RouteItem>('/routes', 'POST', input);
}

/** Cambia el estado de la ruta (PLANNED→IN_PROGRESS→COMPLETED). `PATCH /routes/:id`. */
export function updateRouteStatus(id: string, status: RouteStatus): Promise<MutateResult<RouteItem>> {
  return apiMutate<RouteItem>(`/routes/${id}`, 'PATCH', { status });
}

/** Actualiza una parada (estado y/o orden). `PATCH /routes/:id/stops/:sid`. */
export interface UpdateStopPatch {
  status?: RouteStopStatus;
  sequenceOrder?: number;
}
export function updateStop(routeId: string, stopId: string, patch: UpdateStopPatch): Promise<MutateResult<RouteStopItem>> {
  return apiMutate<RouteStopItem>(`/routes/${routeId}/stops/${stopId}`, 'PATCH', patch);
}

/**
 * Resuelve coordenadas de cada parada contra un lookup `clientId → {lat,lng}` (armado desde
 * `GET /clients`). Pura y testeable. Paradas sin coordenada conocida salen con lat/lng `undefined`.
 */
export type StopWithCoords = RouteStopItem & Partial<LngLat>;
export function resolveStopCoords(
  stops: RouteStopItem[],
  coordsByClientId: Record<string, LngLat | undefined>,
): StopWithCoords[] {
  return stops.map((s) => {
    const c = coordsByClientId[s.clientId];
    return c ? { ...s, latitude: c.latitude, longitude: c.longitude } : { ...s };
  });
}
