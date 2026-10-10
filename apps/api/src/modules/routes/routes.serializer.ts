import type { Prisma, RoutePlan, RouteStop, VisitOutcome } from '@prisma/client';
import { LocationType } from '@prisma/client';
import type { CryptoService } from '../../common/crypto/crypto.service';
import { creditView, suggestedPaymentAmount } from '@kobrax/shared';
import { clientDisplayName, safeDecrypt } from '../clients/clients.serializer';

/** Datos del deudor para pintar la parada. Sólo vienen cuando el query los incluye (`findOne`). */
type StopClient = {
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  locations: {
    id?: string;
    locationType: LocationType;
    address: string | null;
    latitude?: Prisma.Decimal | null;
    longitude?: Prisma.Decimal | null;
    /** Con valor: es de un garante o familiar (no del cliente). */
    relationId?: string | null;
    relation?: { relatedName: string | null } | null;
    /** `client_locations.photo_urls` (JSON): la primera es la foto principal. */
    photoUrls?: unknown;
  }[];
};

/** Todas las fotos de una ubicación, la principal primera. Una lista rara (no es un arreglo de textos) no es una lista. */
export function allPhotos(photoUrls: unknown): string[] {
  return Array.isArray(photoUrls) ? photoUrls.filter((u): u is string => typeof u === 'string') : [];
}

/** La foto principal de una ubicación: la primera de la lista. */
export function mainPhoto(photoUrls: unknown): string | undefined {
  return Array.isArray(photoUrls) && typeof photoUrls[0] === 'string' ? photoUrls[0] : undefined;
}

/**
 * Dónde se cobra: la primera HOME; si no hay ninguna, la primera que exista. Un cliente puede tener
 * domicilio y negocio, y la casa es donde se cobra. **Misma regla que la cartera**
 * (la lista de mora): con dos criterios distintos el pin del mapa y la dirección de la parada podrían apuntar
 * a lugares distintos del mismo cliente.
 */
function primaryLocation(client: StopClient) {
  // Las ubicaciones de garantes y familiares vienen en la misma lista: la «principal» es siempre del propio cliente.
  const own = client.locations.filter((l) => !l.relationId);
  return own.find((l) => l.locationType === LocationType.HOME) ?? own[0];
}

/**
 * La ubicación de la parada: la que se eligió al armar la ruta (`locationId`) y, si no hay —paradas anteriores a
 * F4/12, o armadas sin elegir—, la principal del cliente. Si la elegida ya no existe se cae a la principal: la parada
 * sigue existiendo y numerada.
 */
function stopLocation(client: StopClient, locationId?: string | null) {
  return (locationId ? client.locations.find((l) => l.id === locationId) : undefined) ?? primaryLocation(client);
}

/**
 * La deuda que el cobrador va a reclamar en esa parada. Sale del crédito **de la parada** (`route_stops.credit_id`),
 * no de la suma del deudor: un cliente puede tener más de un crédito (cartera D1) y la parada apunta a uno solo.
 */
type StopCredit = {
  outstandingBalance: unknown;
  currency: string;
  daysPastDue: number;
  externalSource?: string | null;
  syncStatus?: string | null;
  reportedAsOf?: Date | null;
  /** Para la cuota: el origen y los datos congelados/reportados del crédito, y lo que falta del cronograma. */
  origin?: string | null;
  metadata?: unknown;
  installments?: { number: number; dueDate: Date | string; amount: unknown; paidAmount?: unknown; status: string }[];
} | null;

/**
 * La cuota que correspondía pagar, con la misma regla que la ficha de mora y el móvil (`creditView` +
 * `suggestedPaymentAmount` de shared): dos pantallas que muestran «la cuota» no pueden decir números distintos.
 * Sin dato, ausente: nunca un 0 que diría «no hay cuota».
 */
function installmentOf(credit: NonNullable<StopCredit>) {
  const schedule = (credit.installments ?? []).map((i) => ({
    number: i.number,
    dueDate: i.dueDate,
    amount: Number(i.amount),
    paidAmount: Number(i.paidAmount ?? 0),
    status: i.status,
  }));
  const view = creditView({ metadata: credit.metadata, origin: credit.origin, installments: schedule });
  const balance = Number(credit.outstandingBalance);
  return {
    installmentAmount: view.installmentAmount,
    nextDueDate: view.nextDueDate,
    suggestedPaymentAmount: Number.isFinite(balance)
      ? suggestedPaymentAmount({
          external: view.locked,
          outstandingBalance: balance,
          installmentAmount: view.installmentAmount,
          reportedPastDueAmount: view.pastDueAmount,
          installments: schedule,
        })
      : undefined,
  };
}

/**
 * `clientName`/`address` sólo salen con `crypto` y el cliente incluido: la dirección es PII en claro
 * y quien la pide la audita (`findOne`). Sin eso, la parada devuelve ids como siempre.
 */
export function serializeStop(
  s: RouteStop & {
    client?: StopClient;
    creditInfo?: StopCredit;
    visits?: { outcome: VisitOutcome }[];
    /** `HH:mm` de la visita agendada de la que nació (solo si tiene hora fija). */
    scheduledTime?: string | null;
  },
  crypto?: CryptoService,
) {
  const loc = s.client ? stopLocation(s.client, s.locationId) : undefined;
  const credit = s.creditInfo ?? undefined;
  return {
    id: s.id,
    clientId: s.clientId,
    // Contra este crédito se cobra y se promete al registrar el resultado (S5).
    creditId: s.creditId ?? undefined,
    // La visita agendada de la que nació la parada (F4/11): con esto el cliente la marca como «Agendada».
    agendaItemId: s.agendaItemId ?? undefined,
    // La ubicación concreta (F4/12): qué se visita y de quién es — «Garante · Juan Pérez».
    locationId: loc?.id ?? undefined,
    locationType: loc?.locationType ?? undefined,
    locationOwner: loc?.relation?.relatedName ?? undefined,
    // La foto principal de esa ubicación: en los mapas se ve chica para reconocer la casa.
    locationPhotoUrl: mainPhoto(loc?.photoUrls),
    // Todas, para abrirlas en el detalle de la ruta («reconocer la casa»). Ausente si no tiene.
    locationPhotoUrls: allPhotos(loc?.photoUrls).length > 0 ? allPhotos(loc?.photoUrls) : undefined,
    // Hora fija de la visita agendada: la parada que la lleva no se mueve de su lugar al optimizar.
    scheduledTime: s.scheduledTime ?? undefined,
    sequenceOrder: s.sequenceOrder,
    status: s.status,
    visitedAt: s.visitedAt ?? undefined,
    clientName: s.client ? clientDisplayName(s.client) : undefined,
    address: loc && crypto ? (safeDecrypt(crypto, loc.address) ?? undefined) : undefined,
    // El punto de la parada (S3): sin él no entra a la polilínea ni al cálculo de OSRM, pero la
    // parada sigue existiendo y numerada en la lista.
    latitude: loc?.latitude != null ? Number(loc.latitude) : undefined,
    longitude: loc?.longitude != null ? Number(loc.longitude) : undefined,
    // La mora de la tarjeta de RT-4 (S4). Una parada sin crédito los deja en `undefined`
    // y la tarjeta oculta los recuadros — mismo criterio que `address`: la parada existe igual.
    overdueAmount: credit != null ? Number(credit.outstandingBalance) : undefined,
    currency: credit?.currency,
    daysPastDue: credit?.daysPastDue,
    // La cuota que correspondía pagar (si hay dato): la muestra «Registrar gestión» junto al monto cobrado.
    ...(credit ? installmentOf(credit) : {}),
    // Cómo terminó la parada (S6). `status: VISITED` dice que se visitó; esto dice qué pasó.
    // Una parada sin visitar lo deja en `undefined`, y así no entra en ninguna categoría del resumen.
    lastOutcome: s.visits?.[0]?.outcome,
    // D1/D3: crédito de fuente externa — saldo reportado al corte; el cobro no se topea con él.
    externalSource: credit?.externalSource ?? undefined,
    syncStatus: credit?.syncStatus ?? undefined,
    reportedAsOf: credit?.reportedAsOf ? credit.reportedAsOf.toISOString().slice(0, 10) : undefined,
  };
}

type RouteWithStops = RoutePlan & {
  stops?: (RouteStop & {
    client?: StopClient;
    creditInfo?: StopCredit;
    visits?: { outcome: VisitOutcome }[];
    scheduledTime?: string | null;
  })[];
};

export function serializeRoute(r: RouteWithStops, crypto?: CryptoService) {
  return {
    id: r.id,
    collectorId: r.collectorId,
    branchId: r.branchId ?? undefined,
    plannedDate: r.plannedDate,
    status: r.status,
    // Nombre legado (antes «casos»): son paradas. Con las paradas a la vista se cuentan; si no, la columna.
    totalCases: r.stops ? r.stops.length : r.totalCases,
    totalDistanceKm: r.totalDistanceKm != null ? Number(r.totalDistanceKm) : undefined,
    estimatedMinutes: r.estimatedMinutes ?? undefined,
    createdAt: r.createdAt,
    createdBy: r.createdBy ?? undefined,
    startedAt: r.startedAt ?? undefined,
    completedAt: r.completedAt ?? undefined,
    cancelledAt: r.cancelledAt ?? undefined,
    statusReason: r.statusReason ?? undefined,
    stops: r.stops?.map((s) => serializeStop(s, crypto)),
  };
}
