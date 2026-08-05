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
  /** El punto de esa misma ubicación (S3). Sin él la parada existe pero no se puede dibujar. */
  latitude?: number;
  longitude?: number;
  /** El crédito del caso de la parada: contra él se cobra y se promete al registrar el resultado (S5). */
  creditId?: string;
  /**
   * La deuda del crédito **de esta parada** (S4), no la suma del deudor: un cliente puede tener más
   * de un crédito y la parada apunta a uno. Ausentes si la parada no tiene caso o crédito.
   */
  overdueAmount?: number;
  currency?: string;
  daysPastDue?: number;
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

/** Agrega una parada al final del recorrido (S2). `POST /routes/:id/stops`. */
export function addStop(routeId: string, input: { clientId: string; caseId?: string }): Promise<MutateResult<RouteStopItem>> {
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
