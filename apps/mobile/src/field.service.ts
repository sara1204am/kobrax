/**
 * Visitas de campo (Rutas S5 · RT-6). Es lo que cierra la parada: `POST /visits` crea el registro
 * **append-only** con GPS, marca la parada como visitada y deja la gestión en la bitácora del caso —
 * todo eso lo hace el server en una transacción, acá sólo se le habla.
 */
import { apiMutate, type MutateResult } from './api-client';
import type { VisitOutcome } from '@kobrax/shared';
import { currentLocation, type Coords } from './location';

export interface CreateVisitInput {
  routeStopId?: string;
  caseId?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  outcome: VisitOutcome;
  notes?: string;
  /** Campos propios de la variante; los valida el server con la misma función que corre acá. */
  details?: Record<string, unknown>;
  /** La coordenada es la de la parada, no una lectura real del GPS (§5.4). */
  gpsFallback?: boolean;
}

export interface VisitCreated {
  id: string;
  outcome: VisitOutcome;
  capturedAt: string;
}

export function createVisit(input: CreateVisitInput): Promise<MutateResult<VisitCreated>> {
  return apiMutate<VisitCreated>('/visits', 'POST', input);
}

export interface VisitEvidence {
  id: string;
  type: string;
  fileHash: string;
}

/** Sella una foto contra la visita. El hash es el del archivo original, no el de la copia subida. */
export function addVisitEvidence(
  visitId: string,
  body: { type: 'PHOTO' | 'SIGNATURE' | 'DOCUMENT' | 'AUDIO'; fileUrl: string; fileHash: string },
): Promise<MutateResult<VisitEvidence>> {
  return apiMutate<VisitEvidence>(`/visits/${visitId}/evidence`, 'POST', body);
}

/**
 * De dónde salen las coordenadas con las que se registra la visita.
 *
 * **Nunca bloquea al cobrador**: si no hay permiso o no hay señal, cae en la ubicación conocida de la
 * parada y lo marca como estimado. Un cobrador en un sótano tiene que poder cerrar su visita; que el
 * dato quede marcado es lo que evita que después se lea como un GPS real.
 *
 * Devuelve `null` sólo cuando no hay ninguna de las dos: ahí `POST /visits` lo rechazaría igual.
 */
export async function resolveVisitCoords(
  fallback?: { latitude?: number; longitude?: number },
): Promise<(Coords & { gpsFallback: boolean }) | null> {
  const res = await currentLocation();
  if (res.status === 'ok') return { ...res.coords, gpsFallback: false };

  if (fallback?.latitude != null && fallback.longitude != null) {
    return { latitude: fallback.latitude, longitude: fallback.longitude, gpsFallback: true };
  }
  return null;
}
