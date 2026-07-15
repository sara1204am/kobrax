/**
 * Packs offline de mapa (rutas/FUNDACION §11.1-2). Envuelve el `OfflineManager` de MapLibre: descarga
 * los tiles de una región desde la fuente self-hosted (`MAP_STYLE_URL`) y los deja en la DB local, para
 * operar el mapa **sin señal** (regla no-negociable offline). El disparo ("Descargar mapa de zona") vive
 * en Rutas/Ajustes y **sólo se llama con conexión** (el caller chequea `useNetStore`).
 */
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { MAP_STYLE_URL, type LngLat } from './tiles';

export interface RegionBounds {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
}

/** bbox aproximado alrededor de un centro (1° lat ≈ 111 km). Para "descargar mi zona" desde el GPS. */
export function boundsAround(center: LngLat, radiusKm = 15): RegionBounds {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.latitude * Math.PI) / 180));
  return {
    neLat: center.latitude + dLat,
    neLng: center.longitude + dLng,
    swLat: center.latitude - dLat,
    swLng: center.longitude - dLng,
  };
}

export interface DownloadOptions {
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Descarga un pack offline de una región. Resuelve al llegar al 100%; rechaza si el server falla.
 * ponytail: si ya existe un pack con ese `name`, `createPack` rechaza — el caller lo maneja (borrar y reintentar).
 */
export function downloadRegionPack(
  name: string,
  bounds: RegionBounds,
  opts: DownloadOptions = {},
  onProgress?: (percentage: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    OfflineManager.createPack(
      {
        name,
        styleURL: MAP_STYLE_URL,
        minZoom: opts.minZoom ?? 10,
        maxZoom: opts.maxZoom ?? 16,
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
