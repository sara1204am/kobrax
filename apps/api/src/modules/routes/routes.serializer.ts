import type { RoutePlan, RouteStop } from '@prisma/client';

export function serializeStop(s: RouteStop) {
  return {
    id: s.id,
    clientId: s.clientId,
    caseId: s.caseId ?? undefined,
    sequenceOrder: s.sequenceOrder,
    status: s.status,
    visitedAt: s.visitedAt ?? undefined,
  };
}

type RouteWithStops = RoutePlan & { stops?: RouteStop[] };

export function serializeRoute(r: RouteWithStops) {
  return {
    id: r.id,
    collectorId: r.collectorId,
    branchId: r.branchId ?? undefined,
    plannedDate: r.plannedDate,
    status: r.status,
    totalCases: r.totalCases,
    totalDistanceKm: r.totalDistanceKm != null ? Number(r.totalDistanceKm) : undefined,
    estimatedMinutes: r.estimatedMinutes ?? undefined,
    createdAt: r.createdAt,
    stops: r.stops?.map(serializeStop),
  };
}
