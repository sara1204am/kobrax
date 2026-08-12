'use client';

import { useEffect, useRef } from 'react';
// Sin `default`: el paquete exporta con nombre y el `esModuleInterop` de este tsconfig no lo
// inventa.
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, type LngLatLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_ZOOM, FALLBACK_CENTER, MAP_STYLE } from '@/lib/map-style';

export interface MapStop {
  id: string;
  sequenceOrder: number;
  latitude?: number;
  longitude?: number;
  label?: string;
}

/** Dónde se registró una visita: lo que deja ver si el cobrador estuvo donde dijo. */
export interface MapVisit {
  latitude: number;
  longitude: number;
}

/**
 * El recorrido de una ruta.
 *
 * Vive en `components/` y no dentro de la pantalla porque **W9 lo va a querer** para el
 * seguimiento en vivo del cobrador; naciendo adentro de `/rutas/[id]` habría que reescribirlo.
 *
 * Sin ninguna parada con punto no se dibuja nada: un mapa centrado en un país con cero pines no
 * informa, ocupa media pantalla y hace bajar los tiles igual.
 */
export function RouteMap({
  stops,
  visits = [],
  line = [],
}: {
  stops: MapStop[];
  visits?: MapVisit[];
  /** La polilínea por las calles. Vacía = las paradas se unen con rectas (sin motor o sin red). */
  line?: { latitude: number; longitude: number }[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const located = stops.filter(
    (s): s is MapStop & { latitude: number; longitude: number } => s.latitude != null && s.longitude != null,
  );

  useEffect(() => {
    if (!container.current || located.length === 0) return;

    const map = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE,
      center: FALLBACK_CENTER,
      zoom: DEFAULT_ZOOM,
      // El panel no gira ni inclina el mapa: es una vista de supervisión, no de navegación.
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    for (const stop of located) {
      const pin = document.createElement('div');
      pin.className =
        'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-k-navy text-[12px] font-semibold text-white shadow';
      pin.textContent = String(stop.sequenceOrder);
      const marker = new Marker({ element: pin }).setLngLat([stop.longitude, stop.latitude]);
      if (stop.label) marker.setPopup(new Popup({ offset: 16 }).setText(stop.label));
      marker.addTo(map);
    }

    // El punto de la visita es más chico y de otro color: no compite con la parada planificada,
    // y la distancia entre los dos es justo lo que se viene a mirar.
    for (const visit of visits) {
      const dot = document.createElement('div');
      dot.className = 'h-3 w-3 rounded-full border-2 border-white bg-k-purple shadow';
      new Marker({ element: dot }).setLngLat([visit.longitude, visit.latitude]).addTo(map);
    }

    const path: [number, number][] =
      line.length > 0
        ? line.map((p) => [p.longitude, p.latitude])
        : located.map((s) => [s.longitude, s.latitude]);

    map.on('load', () => {
      if (path.length > 1) {
        map.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path } },
        });
        map.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          // Sin polilínea del motor, las paradas se unen con rectas: se marca punteado para no
          // hacer pasar por «camino» algo que no lo es.
          paint: {
            'line-color': '#5B7DBE',
            'line-width': 4,
            ...(line.length === 0 ? { 'line-dasharray': [2, 2] } : {}),
          },
        });
      }

      // Encuadre sobre todo lo dibujado, no sobre un centro fijo.
      const bounds = new LngLatBounds();
      for (const point of [...path, ...visits.map((v) => [v.longitude, v.latitude] as [number, number])]) {
        bounds.extend(point as LngLatLike);
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
    });

    return () => map.remove();
    // Las tres listas se rearman en cada render del server component; comparar por identidad
    // recrearía el mapa sin motivo. La ruta no cambia mientras la pantalla está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.length, visits.length, line.length]);

  if (located.length === 0) return null;

  return <div ref={container} className="h-[420px] w-full overflow-hidden rounded-2xl border border-k-border" />;
}
