/**
 * Packs offline de mapa (rutas/FUNDACION §11.1-2). Envuelve el `OfflineManager` de MapLibre: descarga
 * los tiles de una región desde la fuente self-hosted (`MAP_STYLE_URL`) y los deja en la DB local, para
 * operar el mapa **sin señal** (regla no-negociable offline). El disparo ("Descargar mapa de zona") vive
 * en Rutas/Ajustes y **sólo se llama con conexión** (el caller chequea `useNetStore`).
 */
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { MAP_PACK_MAX_ZOOM, MAP_PACK_MIN_ZOOM, MAP_PACK_RADIUS_KM } from '@kobrax/shared';
import { MAP_STYLE_URL, type LngLat } from './tiles';
import { planPack, type RegionBounds } from './pack-budget';

export type { RegionBounds } from './pack-budget';

/**
 * bbox aproximado alrededor de un centro (1° lat ≈ 111 km). Para "descargar mi zona" desde el GPS.
 * El radio por defecto es el del presupuesto (D-9): 10 km, no los 15 de antes.
 */
export function boundsAround(center: LngLat, radiusKm: number = MAP_PACK_RADIUS_KM): RegionBounds {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.latitude * Math.PI) / 180));
  return {
    neLat: center.latitude + dLat,
    neLng: center.longitude + dLng,
    swLat: center.latitude - dLat,
    swLng: center.longitude - dLng,
  };
}

/** Lo que se asume que pesa un pack ya descargado (el de referencia, 10 km z10–15). Ver `offline-budget.ts`. */
const REFERENCE_PACK_BYTES = 14 * 1024 * 1024;

export interface DownloadOptions {
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Descarga un pack offline de una región. Resuelve al llegar al 100%; rechaza si el server falla.
 * ponytail: si ya existe un pack con ese `name`, `createPack` rechaza — el caller lo maneja (borrar y reintentar).
 */
export async function downloadRegionPack(
  name: string,
  bounds: RegionBounds,
  opts: DownloadOptions = {},
  onProgress?: (percentage: number) => void,
): Promise<void> {
  // El presupuesto se decide ANTES de gastar datos móviles: tamaño de la zona, cuántas ya hay y cuánto lugar queda.
  const existing = await OfflineManager.getPacks().catch(() => []);
  const plan = planPack({
    bounds,
    minZoom: opts.minZoom ?? MAP_PACK_MIN_ZOOM,
    maxZoom: opts.maxZoom ?? MAP_PACK_MAX_ZOOM,
    // Un pack ya descargado pesa lo que pesa el de referencia: es una estimación para el tope, no una medición.
    existing: { count: existing.length, bytes: existing.length * REFERENCE_PACK_BYTES },
  });
  if (!plan.ok) throw new Error(plan.message);

  return new Promise<void>((resolve, reject) => {
    // Un pack necesita una URL de estilo propia: el raster público de OSM del fallback de desarrollo
    // no se puede descargar en masa (su política lo prohíbe) y `createPack` no acepta un estilo inline.
    if (!MAP_STYLE_URL) {
      return reject(new Error('Falta EXPO_PUBLIC_MAP_STYLE_URL: los mapas offline necesitan la fuente propia'));
    }
    OfflineManager.createPack(
      {
        name,
        styleURL: MAP_STYLE_URL,
        minZoom: plan.minZoom,
        maxZoom: plan.maxZoom,
        bounds: [
          [bounds.neLng, bounds.neLat],
          [bounds.swLng, bounds.swLat],
        ],
      },
      (_pack, status) => {
        onProgress?.(status.percentage);
        if (status.percentage >= 100) resolve();
      },
      (_pack, err) => reject(new Error(err.message)),
    ).catch(reject);
  });
}

export interface PackInfo {
  name: string;
  percentage: number;
}

/** Packs descargados + su progreso (para la pantalla de gestión en Ajustes). */
export async function listPacks(): Promise<PackInfo[]> {
  const packs = await OfflineManager.getPacks();
  return Promise.all(
    packs.map(async (p) => {
      const s = await p.status();
      return { name: p.name ?? s.name, percentage: s.percentage };
    }),
  );
}

export function deleteRegionPack(name: string): Promise<void> {
  return OfflineManager.deletePack(name);
}
