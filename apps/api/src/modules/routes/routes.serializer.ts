import type { Prisma, RoutePlan, RouteStop } from '@prisma/client';
import { LocationType } from '@prisma/client';
import type { CryptoService } from '../../common/crypto/crypto.service';
import { clientDisplayName, safeDecrypt } from '../clients/clients.serializer';

/** Datos del deudor para pintar la parada. Sólo vienen cuando el query los incluye (`findOne`). */
type StopClient = {
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  locations: {
    locationType: LocationType;
    address: string | null;
    latitude?: Prisma.Decimal | null;
    longitude?: Prisma.Decimal | null;
  }[];
};

/**
 * Dónde se cobra: la primera HOME; si no hay ninguna, la primera que exista. Un cliente puede tener
 * domicilio y negocio, y la casa es donde se cobra. **Misma regla que la cartera** (`portfolioExtra`
 * de cases): con dos criterios distintos el pin del mapa y la dirección de la parada podrían apuntar
 * a lugares distintos del mismo cliente.
 */
function primaryLocation(client: StopClient) {
  return client.locations.find((l) => l.locationType === LocationType.HOME) ?? client.locations[0];
}

/**
 * La deuda que el cobrador va a reclamar en esa parada. Sale del crédito **del caso de la parada**,
 * no de la suma del deudor: un cliente puede tener más de un crédito (cartera D1) y la parada apunta
 * a uno solo. Sólo viene cuando el query incluye el caso.
 */
type StopCase = {
  creditId?: string;
  credit: { outstandingBalance: unknown; currency: string; daysPastDue: number } | null;
};

/**
 * `clientName`/`address` sólo salen con `crypto` y el cliente incluido: la dirección es PII en claro
 * y quien la pide la audita (`findOne`). Sin eso, la parada devuelve ids como siempre.
 */
export function serializeStop(
  s: RouteStop & { client?: StopClient; case?: StopCase | null },
  crypto?: CryptoService,
) {
  const loc = s.client ? primaryLocation(s.client) : undefined;
  const credit = s.case?.credit ?? undefined;
  return {
    id: s.id,
    clientId: s.clientId,
    caseId: s.caseId ?? undefined,
    // El crédito del caso: contra él se cobra y se promete al registrar el resultado (S5).
    creditId: s.case?.creditId,
    sequenceOrder: s.sequenceOrder,
    status: s.status,
    visitedAt: s.visitedAt ?? undefined,
    clientName: s.client ? clientDisplayName(s.client) : undefined,
    address: loc && crypto ? (safeDecrypt(crypto, loc.address) ?? undefined) : undefined,
    // El punto de la parada (S3): sin él no entra a la polilínea ni al cálculo de OSRM, pero la
    // parada sigue existiendo y numerada en la lista.
    latitude: loc?.latitude != null ? Number(loc.latitude) : undefined,
    longitude: loc?.longitude != null ? Number(loc.longitude) : undefined,
    // La mora de la tarjeta de RT-4 (S4). Una parada sin caso o sin crédito los deja en `undefined`
    // y la tarjeta oculta los recuadros — mismo criterio que `address`: la parada existe igual.
    overdueAmount: credit != null ? Number(credit.outstandingBalance) : undefined,
    currency: credit?.currency,
    daysPastDue: credit?.daysPastDue,
  };
}

type RouteWithStops = RoutePlan & {
  stops?: (RouteStop & { client?: StopClient; case?: StopCase | null })[];
};

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
