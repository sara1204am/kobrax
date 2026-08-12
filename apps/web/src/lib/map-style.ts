import type { StyleSpecification } from 'maplibre-gl';

/**
 * Fuente de tiles del mapa. **Self-hosted en R2/S3**: un `style.json` que apunta a extractos OSM
 * regionales, sin API key ni vendor lock. Es la misma fuente que el móvil (`maps/tiles.ts`), así
 * que el escritorio y el teléfono dibujan el mismo mundo.
 *
 * Mientras esos extractos no existan, cae a **tiles raster de openstreetmap.org**, que sí tienen
 * datos a nivel de calle. El demo público de MapLibre (`demotiles`) NO sirve: es un mundo de
 * contornos sin datos más allá de zoom ~5, y a zoom de ciudad se ve un fondo vacío con los pines
 * flotando — al móvil ya le pasó.
 *
 * ⚠️ El raster de OSM es **sólo para desarrollo**: su política de uso prohíbe apps en producción.
 * En producción se define `NEXT_PUBLIC_MAP_STYLE_URL`.
 *
 * Es la única variable `NEXT_PUBLIC_` del panel, y con motivo: la pide el navegador para bajar los
 * tiles, así que no puede vivir del lado del servidor como `KOBRAX_API_URL`.
 */
const OSM_RASTER_STYLE: StyleSpecification = {
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

export const MAP_STYLE: string | StyleSpecification =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? OSM_RASTER_STYLE;

/** Encuadre por defecto sin coordenada de referencia (Santa Cruz, tenant demo). */
export const FALLBACK_CENTER: [number, number] = [-63.1821, -17.7833];
export const DEFAULT_ZOOM = 13;
