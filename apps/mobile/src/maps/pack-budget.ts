/**
 * Presupuesto de una descarga de mapa offline (D-9), **sin tocar el módulo nativo** para poder probarlo.
 *
 * Se decide ANTES de descargar: una descarga que se queda sin lugar a la mitad deja un pack roto y gasta datos móviles del
 * cobrador. Los números y su derivación viven en `@kobrax/shared` (`offline-budget.ts`).
 */
import {
  MAP_PACK_MAX_REGIONS,
  MAP_PACK_MAX_ZOOM,
  MAP_PACK_MIN_ZOOM,
  MAP_PACK_RADIUS_KM,
  decidePack,
  type PackDecision,
} from '@kobrax/shared';

export interface RegionBounds {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
}

/** El lado más largo de un bbox, en km (1° de latitud ≈ 111 km; la longitud se achica con el coseno). */
export function boundsSideKm(b: RegionBounds): number {
  const midLat = (b.neLat + b.swLat) / 2;
  const heightKm = Math.abs(b.neLat - b.swLat) * 111;
  const widthKm = Math.abs(b.neLng - b.swLng) * 111 * Math.cos((midLat * Math.PI) / 180);
  return Math.max(heightKm, widthKm);
}

export type PackPlan =
  | { ok: true; tiles: number; bytes: number; minZoom: number; maxZoom: number }
  | { ok: false; reason: PackRefusal; message: string };

export type PackRefusal = 'too-many-tiles' | 'over-storage' | 'too-many-regions';

/**
 * ¿Se puede descargar esta región, con estos zooms, dado lo que ya hay? Devuelve el motivo en palabras del cobrador.
 * `existing` = los packs ya descargados (cuántos y cuánto pesan, estimado).
 */
export function planPack(args: {
  bounds: RegionBounds;
  minZoom?: number;
  maxZoom?: number;
  existing: { count: number; bytes: number };
}): PackPlan {
  const minZoom = args.minZoom ?? MAP_PACK_MIN_ZOOM;
  const maxZoom = Math.min(args.maxZoom ?? MAP_PACK_MAX_ZOOM, MAP_PACK_MAX_ZOOM);

  if (args.existing.count >= MAP_PACK_MAX_REGIONS) {
    return {
      ok: false,
      reason: 'too-many-regions',
      message: `Ya tienes ${args.existing.count} zonas descargadas (máximo ${MAP_PACK_MAX_REGIONS}). Elimina una para bajar otra.`,
    };
  }

  const radiusKm = boundsSideKm(args.bounds) / 2;
  const midLat = (args.bounds.neLat + args.bounds.swLat) / 2;
  const d: PackDecision = decidePack({ radiusKm, latitude: midLat, minZoom, maxZoom, usedBytes: args.existing.bytes });

  if (d.ok) return { ok: true, tiles: d.tiles, bytes: d.bytes, minZoom, maxZoom };
  return {
    ok: false,
    reason: d.reason,
    message:
      d.reason === 'too-many-tiles'
        ? `La zona es muy grande (${d.tiles} tiles). Elige un radio de hasta ${MAP_PACK_RADIUS_KM} km.`
        : `No hay lugar para esta zona (pesaría unos ${Math.round(d.bytes / 1048576)} MB). Elimina una descargada.`,
  };
}
