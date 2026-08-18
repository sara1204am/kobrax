'use client';

import { useEffect, useRef } from 'react';
// Sin `default`: el paquete exporta con nombre y el `esModuleInterop` de este tsconfig no lo inventa.
import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_ZOOM, FALLBACK_CENTER, MAP_STYLE } from '@/lib/map-style';

/** Al que se acerca cuando ya hay un punto: la manzana, no la ciudad. */
const PIN_ZOOM = 16;

/**
 * Marcar un punto en el mapa, o mirarlo.
 *
 * 🔴 **No es `RouteMap` con un `onClick`.** Aquél dibuja un recorrido cerrado —se arma una vez, no
 * reacciona a que un punto cambie y sin paradas no dibuja nada—, que es lo contrario de lo que hace
 * falta acá: arrancar vacío y moverse a donde toque quien lo usa. Meter los dos comportamientos en
 * un componente lo dejaba peleado consigo mismo.
 *
 * **Sin `onChange` es un visor**: el pin no se arrastra y el mapa no escucha clics. Es el mismo
 * componente porque la diferencia entre ver y elegir es justo esa, y dos archivos para eso serían
 * dos mapas que mantener.
 *
 * ponytail: el pin es un `Marker` por defecto de MapLibre, no uno dibujado. Alcanza para uno solo;
 * si algún día hay que distinguir varios, ahí se le pone elemento propio como en `RouteMap`.
 */
export function MapPicker({
  latitude,
  longitude,
  onChange,
  height = 200,
  label,
}: {
  latitude?: number;
  longitude?: number;
  /** Ausente = visor. Presente = tocar el mapa o arrastrar el pin mueven el punto. */
  onChange?: (c: { latitude: number; longitude: number }) => void;
  height?: number;
  /** Qué es este mapa, para quien no lo ve. Lo traduce quien lo usa: acá no viven textos. */
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  /*
   * El callback en una ref y no en las dependencias: el padre lo rearma en cada tecla que se escribe
   * en el formulario, y el mapa se destruiría y volvería a bajar los tiles con cada una.
   */
  const cb = useRef(onChange);
  cb.current = onChange;

  // El mapa se crea UNA vez. Mover el punto es mover el pin, no rehacer el mapa.
  useEffect(() => {
    if (!container.current) return;

    const m = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE,
      center: latitude != null && longitude != null ? [longitude, latitude] : FALLBACK_CENTER,
      zoom: latitude != null && longitude != null ? PIN_ZOOM : DEFAULT_ZOOM,
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.on('click', (e) => cb.current?.({ latitude: e.lngLat.lat, longitude: e.lngLat.lng }));
    map.current = m;

    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // Sólo al montar: el centro inicial es el que había, y después manda el pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El pin sigue al punto: aparece, se mueve o se va, sin tocar el mapa.
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    if (latitude == null || longitude == null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }

    if (!marker.current) {
      marker.current = new Marker({ draggable: Boolean(onChange), color: '#1A3A52' }).setLngLat([longitude, latitude]);
      marker.current.on('dragend', () => {
        const c = marker.current!.getLngLat();
        cb.current?.({ latitude: c.lat, longitude: c.lng });
      });
      marker.current.addTo(m);
    } else {
      marker.current.setLngLat([longitude, latitude]);
    }
    m.easeTo({ center: [longitude, latitude], zoom: Math.max(m.getZoom(), PIN_ZOOM), duration: 300 });
  }, [latitude, longitude, onChange]);

  return (
    <div
      ref={container}
      style={{ height }}
      className="w-full overflow-hidden rounded-xl border border-k-border"
      // Sin esto es un `div` mudo para quien no ve: el mapa no es la única forma de cargar el punto
      // —los campos de latitud y longitud están al lado— pero tiene que decir qué es.
      role="application"
      aria-label={label}
    />
  );
}
