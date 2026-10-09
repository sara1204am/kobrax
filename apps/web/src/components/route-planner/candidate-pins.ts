import { haversineKm, type AvailableCredit, type PlanLocation, type Point } from '@/lib/plan';
import type { MapPoint } from './points-map';

/**
 * El id de un pin de candidato: **crédito y ubicación**, porque un cliente tiene varios lugares donde se lo puede
 * visitar (domicilio, trabajo, un garante) y cada uno es un pin. Tocar uno elige el crédito **con esa ubicación**.
 *
 * El pin de una parada ya elegida lleva solo el id del crédito (o de la parada): no hay `@`.
 */
export const pinId = (creditId: string, locationId?: string) => (locationId ? `${creditId}@${locationId}` : creditId);

export function parsePinId(id: string): { creditId: string; locationId?: string } {
  const i = id.indexOf('@');
  return i < 0 ? { creditId: id } : { creditId: id.slice(0, i), locationId: id.slice(i + 1) || undefined };
}

/** «Garante · Juan Pérez · Calle 5», o «Domicilio · Calle 12»: de qué lugar se habla. */
export function describeLocation(loc: PlanLocation, typeLabel: (type: string) => string): string {
  const kind = loc.locationType ? typeLabel(loc.locationType) : '';
  const owner = loc.ownerName ? ` · ${loc.ownerName}` : '';
  return [`${kind}${owner}`.trim(), loc.address].filter(Boolean).join(' · ');
}

/**
 * Los pines de la mora que **todavía se puede sumar**: uno por cada ubicación dibujable de cada crédito.
 *
 * 🔴 **Todas, no sólo la principal.** Al planificar importa a cuál puerta se va: el cliente puede estar en el trabajo a
 * esa hora, o la visita puede ser al garante. Con un solo pin por cliente esa decisión se tomaba a ciegas.
 */
export function candidatePins(
  rows: AvailableCredit[],
  opts: {
    /** Créditos que ya van en la ruta: no se ofrecen de nuevo. */
    skip: Set<string>;
    detail: (c: AvailableCredit) => string;
    typeLabel: (type: string) => string;
  },
): MapPoint[] {
  return rows.flatMap((c) =>
    opts.skip.has(c.id)
      ? []
      : (c.locations ?? []).map((loc, i) => ({
          // Sin id de ubicación (dato viejo) el índice mantiene el pin único.
          id: pinId(c.id, loc.id ?? `i${i}`),
          latitude: loc.latitude,
          longitude: loc.longitude,
          label: c.clientName ?? undefined,
          detail: [opts.detail(c), describeLocation(loc, opts.typeLabel)].filter(Boolean).join(' · '),
          picked: false,
        })),
  );
}

/**
 * Las que **quedan cerca de la ruta**: créditos en mora sin ruta a menos de `km` de alguna parada, con la distancia
 * a la más cercana. Es la sugerencia de visita preventiva: «ya voy a estar por ahí».
 *
 * La distancia es en línea recta (el pájaro, no la calle): sirve para «¿queda cerca?» y no cuesta una llamada al motor.
 */
export function nearbySuggestions(
  rows: AvailableCredit[],
  stops: Point[],
  km: number,
): { credit: AvailableCredit; location: PlanLocation; /** Su lugar entre las ubicaciones del crédito: arma el mismo id de pin que `candidatePins`. */ index: number; km: number }[] {
  if (stops.length === 0) return [];
  return rows
    .flatMap((credit) => {
      let best: { location: PlanLocation; index: number; km: number } | null = null;
      for (const [index, location] of (credit.locations ?? []).entries()) {
        for (const stop of stops) {
          const d = haversineKm(stop, location);
          if (d <= km && (!best || d < best.km)) best = { location, index, km: d };
        }
      }
      return best ? [{ credit, ...best }] : [];
    })
    .sort((a, b) => a.km - b.km);
}

/** «350 m» o «1,2 km»: bajo el kilómetro se dice en metros. */
export function distanceLabel(km: number, locale = 'es'): string {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  return `${km.toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
}
