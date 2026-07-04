/** Estado de un plan de ruta de cobranza. */
export enum RouteStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** Estado de una parada dentro de la ruta. */
export enum RouteStopStatus {
  PENDING = 'PENDING',
  IN_ROUTE = 'IN_ROUTE',
  VISITED = 'VISITED',
  SKIPPED = 'SKIPPED',
}
