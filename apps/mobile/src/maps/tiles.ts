/**
 * Fuente de tiles del mapa (rutas/FUNDACION §11.1): **self-hosted en R2/S3** — un `style.json` que
 * apunta a extractos OSM regionales, sin API key ni vendor lock. Se configura por env
 * (`EXPO_PUBLIC_MAP_STYLE_URL`) y es lo que va a producción.
 *
 * Mientras esos extractos no existan, el mapa cae a **tiles raster de openstreetmap.org**, que sí
 * tienen datos a nivel de calle. El demo público de MapLibre (`demotiles`) NO sirve: es un mundo de
 * contornos sin datos más allá de zoom ~5, y a zoom de ciudad se ve un fondo vacío con los pines
 * flotando — que es exactamente lo que pasaba.
 *
 * ⚠ El raster de OSM es **sólo para desarrollo**: su política de uso prohíbe apps en producción y
 * descargas masivas. Por eso los packs offline exigen `MAP_STYLE_URL` (ver `offline-packs.service`).
 */

/** Estilo raster mínimo sobre los tiles públicos de OSM. Reemplazable por la URL self-hosted. */
const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** URL del estilo self-hosted. `undefined` hasta que los extractos estén publicados en R2. */
export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL;

/** Lo que se le pasa a `MapView`: la URL self-hosted si está, si no el raster de desarrollo. */
export const MAP_STYLE: string | object = MAP_STYLE_URL ?? OSM_RASTER_STYLE;

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
