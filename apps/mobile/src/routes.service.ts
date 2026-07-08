/**
 * Rutas de campo (solo lectura en P1). Thin sobre `apiQuery`; base del resumen de jornada
 * del Home (P1) y de la pantalla de Rutas (P3). Tipos según `routes.serializer.ts`.
 */
import { RouteStopStatus, type RouteStatus } from '@kobrax/shared';
import { apiQuery, toQuery, type QueryResult } from './api-client';

export interface RouteStopItem {
  id: string;
  clientId: string;
  caseId?: string;
  sequenceOrder: number;
  status: RouteStopStatus;
  visitedAt?: string;
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
