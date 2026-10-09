import type { FieldEvidence, FieldVisit } from '@prisma/client';

/**
 * Payload público de una visita de campo.
 *
 * Las coordenadas salen como número: en la base son `Decimal` de Prisma, y serializado a JSON eso
 * viaja como string — el mapa del panel recibiría `"−17.39"` y no dibujaría nada.
 *
 * `details` viaja tal cual: son los campos propios de la variante que validó `validateVisitDetails`,
 * y el panel muestra los que sabe nombrar sin inventar el resto.
 */
export function serializeVisit(v: FieldVisit) {
  return {
    id: v.id,
    creditId: v.creditId ?? undefined,
    routeStopId: v.routeStopId ?? undefined,
    collectorId: v.collectorId,
    latitude: Number(v.latitude),
    longitude: Number(v.longitude),
    accuracy: v.accuracy != null ? Number(v.accuracy) : undefined,
    outcome: v.outcome,
    notes: v.notes ?? undefined,
    details: (v.details ?? {}) as Record<string, unknown>,
    capturedAt: v.capturedAt.toISOString(),
    // Quién la registró y desde dónde: una visita cargada desde el panel lo dice (F4/12). Null en las anteriores.
    registeredBy: v.registeredBy ?? undefined,
    source: (v.source === 'WEB' ? 'WEB' : 'MOBILE') as 'MOBILE' | 'WEB',
    correctsVisitId: v.correctsVisitId ?? undefined,
  };
}

/**
 * Una evidencia sellada.
 *
 * `fileUrl` viaja tal cual se guardó: `uploads` devuelve `/api/uploads/<nombre>` —una ruta, no un
 * nombre suelto— y esa ruta existe igual en el móvil y en el panel. El hash se manda entero —64
 * caracteres— porque es lo que prueba que el archivo no cambió; recortarlo lo volvería decorativo.
 */
export function serializeEvidence(e: FieldEvidence) {
  return {
    id: e.id,
    type: e.type,
    fileUrl: e.fileUrl,
    fileHash: e.fileHash,
    latitude: e.latitude != null ? Number(e.latitude) : undefined,
    longitude: e.longitude != null ? Number(e.longitude) : undefined,
    capturedAt: e.capturedAt.toISOString(),
  };
}

export function serializeVisitDetail(v: FieldVisit & { evidences: FieldEvidence[] }) {
  return { ...serializeVisit(v), evidences: v.evidences.map(serializeEvidence) };
}
