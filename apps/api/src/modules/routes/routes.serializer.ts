import type { RoutePlan, RouteStop } from '@prisma/client';
import { LocationType } from '@prisma/client';
import type { CryptoService } from '../../common/crypto/crypto.service';
import { clientDisplayName, safeDecrypt } from '../clients/clients.serializer';

/** Datos del deudor para pintar la parada. Sólo vienen cuando el query los incluye (`findOne`). */
type StopClient = {
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  locations: { locationType: LocationType; address: string | null }[];
};

/**
 * Dirección donde se cobra: la primera HOME; si no hay ninguna, la primera que exista.
 * Un cliente puede tener domicilio y negocio, y la casa es donde se cobra.
 */
function primaryAddress(client: StopClient, crypto: CryptoService): string | undefined {
  const loc = client.locations.find((l) => l.locationType === LocationType.HOME) ?? client.locations[0];
  return safeDecrypt(crypto, loc?.address ?? null) ?? undefined;
}

/**
 * `clientName`/`address` sólo salen con `crypto` y el cliente incluido: la dirección es PII en claro
 * y quien la pide la audita (`findOne`). Sin eso, la parada devuelve ids como siempre.
 */
export function serializeStop(s: RouteStop & { client?: StopClient }, crypto?: CryptoService) {
  return {
    id: s.id,
    clientId: s.clientId,
    caseId: s.caseId ?? undefined,
    sequenceOrder: s.sequenceOrder,
    status: s.status,
    visitedAt: s.visitedAt ?? undefined,
    clientName: s.client ? clientDisplayName(s.client) : undefined,
    address: s.client && crypto ? primaryAddress(s.client, crypto) : undefined,
  };
}

type RouteWithStops = RoutePlan & { stops?: (RouteStop & { client?: StopClient })[] };

export function serializeRoute(r: RouteWithStops, crypto?: CryptoService) {
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
    stops: r.stops?.map((s) => serializeStop(s, crypto)),
  };
}
