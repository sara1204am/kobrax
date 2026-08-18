'use client';

import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, type LngLatLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_ZOOM, FALLBACK_CENTER, MAP_STYLE } from '@/lib/map-style';

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * Los deudores **que se van marcando**, en el mapa.
 *
 * 🔴 **No es `RouteMap`, y por un motivo concreto**: ése se arma una vez y no reacciona a cambios —
 * lo dice su propio comentario—, así que para reflejar cada tilde habría que remontarlo. Marcar
 * ocho clientes serían ocho mapas creados y destruidos, con sus tiles: se ve el parpadeo y se nota
 * en un equipo lento. Acá el mapa **se crea una sola vez** y en cada cambio se sincronizan los
 * marcadores, que es lo único que cambió.
 *
 * Tampoco numera ni une los puntos: el orden de la ruta lo decide el servidor al armarla, así que
 * dibujar 1 → 2 → 3 en el orden en que alguien fue tildando sería inventar un recorrido.
 */
export function PointsMap({ points, height }: { points: MapPoint[]; height: number }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<string, Marker>());

  // El mapa, una sola vez. Se destruye al salir de la pantalla, no al cambiar la selección.
  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE,
      center: FALLBACK_CENTER,
      zoom: DEFAULT_ZOOM,
      // El panel no gira ni inclina: es una vista de supervisión, no de navegación.
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: { compact: true },
    });
    map.current.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    return () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  /*
   * Sincronizar: agregar los que entraron, sacar los que se fueron, dejar quietos los que siguen.
   * Recrearlos todos en cada cambio haría parpadear los pines que no se movieron.
   */
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const vivos = new Set(points.map((p) => p.id));
    for (const [id, marker] of markers.current) {
      if (!vivos.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }

    for (const p of points) {
      if (markers.current.has(p.id)) continue;
      const pin = document.createElement('div');
      pin.className = 'h-4 w-4 rounded-full border-2 border-white bg-k-navy shadow';
      const marker = new Marker({ element: pin }).setLngLat([p.longitude, p.latitude]);
      if (p.label) marker.setPopup(new Popup({ offset: 12 }).setText(p.label));
      marker.addTo(m);
      markers.current.set(p.id, marker);
    }

    // Encuadre sobre lo que hay. Con un solo punto, `fitBounds` haría un zoom absurdo: se centra.
    if (points.length === 1) {
      m.easeTo({ center: [points[0]!.longitude, points[0]!.latitude], zoom: 15, duration: 300 });
      return;
    }
    const bounds = new LngLatBounds();
    for (const p of points) bounds.extend([p.longitude, p.latitude] as LngLatLike);
    if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 300 });
  }, [points]);

  // El alto cambia al agrandar: MapLibre no se entera solo de que su caja creció.
  useEffect(() => {
    map.current?.resize();
  }, [height]);

  return (
    <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-2xl border border-k-border" />
  );
}
