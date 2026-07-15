/**
 * Fuente de tiles del mapa (rutas/FUNDACION §11.1): **self-hosted en R2/S3** — un `style.json` que
 * apunta a extractos OSM regionales, sin API key ni vendor lock. Se configura por env
 * (`EXPO_PUBLIC_MAP_STYLE_URL`). Hasta que existan los extractos en R2, cae al demo público de
 * MapLibre (online, baja resolución) SÓLO para el smoke de render. Los packs offline se descargan
 * de esta misma fuente (ver `offline-packs.service.ts`).
 */
export const MAP_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? 'https://demotiles.maplibre.org/style.json';

export type LngLat = { latitude: number; longitude: number };

/** Encuadre por defecto sin coordenada de referencia (Santa Cruz, tenant demo). */
export const FALLBACK_CENTER: LngLat = { latitude: -17.7833, longitude: -63.1821 };

/** Zoom de ciudad para vistas generales; zoom de pin para cuando hay un punto concreto. */
export const DEFAULT_ZOOM = 13;
export const PIN_ZOOM = 16;

/** MapLibre trabaja en `[lng, lat]`; el resto de la app en `{latitude, longitude}`. Único punto de conversión. */
export function toLngLat(c: LngLat): [number, number] {
  return [c.longitude, c.latitude];
}
export function fromLngLat([longitude, latitude]: [number, number]): LngLat {
  return { latitude, longitude };
}
