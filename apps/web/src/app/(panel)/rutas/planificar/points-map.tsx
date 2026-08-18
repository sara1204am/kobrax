'use client';

import { useEffect, useRef } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type LngLatLike,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_ZOOM, FALLBACK_CENTER, MAP_STYLE } from '@/lib/map-style';

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
  /** Ya está en la ruta que se arma. Se pinta distinto de los que todavía se pueden elegir. */
  picked?: boolean;
}

export interface MapCircle {
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** Cuánto mide, escrito: «500 m», «2 km». Va pegado al borde, que es donde se mide. */
  label?: string;
}

/**
 * Los deudores en el mapa, y —si se pide— **un círculo para buscar por área**.
 *
 * 🔴 **No es `RouteMap`, y por un motivo concreto**: ése se arma una vez y no reacciona a cambios,
 * así que para reflejar cada tilde habría que remontarlo. Marcar ocho clientes serían ocho mapas
 * creados y destruidos, con sus tiles: se ve el parpadeo y se nota en un equipo lento. Acá el mapa
 * **se crea una sola vez** y en cada cambio se sincroniza sólo lo que cambió.
 *
 * 🔴 **El arrastre del círculo no pasa por React.** Mientras se mueve, se redibuja el polígono
 * directamente sobre el mapa —60 veces por segundo si hace falta— y recién **al soltar** se avisa
 * hacia arriba. Actualizar el estado en cada frame volvería a filtrar y a re-renderizar la lista
 * entera cientos de veces, y ahí se acaba la fluidez.
 */
export function PointsMap({
  points,
  height,
  circle,
  onCircleMove,
  onPointClick,
}: {
  points: MapPoint[];
  height: number;
  circle?: MapCircle;
  /** Dónde quedó el centro al soltarlo. Sin esto, el círculo se dibuja pero no filtra nada. */
  onCircleMove?: (center: { latitude: number; longitude: number }) => void;
  /**
   * Tocar un punto lo marca o lo desmarca, igual que su casilla en la lista.
   *
   * 🔴 Es el mismo acto en dos lados: mirando el mapa se decide «éste sí, éste no» por dónde queda,
   * y obligar a volver a la lista a buscar la fila para tildarla rompe justo ese hilo.
   */
  onPointClick?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const center = useRef<Marker | null>(null);
  /** El rótulo con el radio, pegado al borde norte del círculo. */
  const label = useRef<Marker | null>(null);
  const ready = useRef(false);
  /*
   * Las últimas funciones que avisan. Los marcadores se crean **una vez** y sus listeners quedarían
   * atados a la primera versión: con un ref, siempre llaman a la de ahora — que es la que conoce la
   * selección actual.
   */
  const notify = useRef(onCircleMove);
  notify.current = onCircleMove;
  const click = useRef(onPointClick);
  click.current = onPointClick;

  // El mapa, una sola vez. Se destruye al salir de la pantalla, no al cambiar la selección.
  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE,
      center: FALLBACK_CENTER,
      zoom: DEFAULT_ZOOM,
      // El panel no gira ni inclina: es una vista de supervisión, no de navegación.
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      // La fuente del área nace vacía: así el `setData` de cada movimiento no tiene que crearla.
      m.addSource(AREA, { type: 'geojson', data: emptyArea() });
      m.addLayer({ id: `${AREA}-fill`, type: 'fill', source: AREA, paint: { 'fill-color': '#5B7DBE', 'fill-opacity': 0.12 } });
      m.addLayer({
        id: `${AREA}-line`,
        type: 'line',
        source: AREA,
        // 🔴 Segmentado y grueso: un borde continuo se confunde con una calle o el límite de un
        // barrio del mapa base. Cortado se lee como lo que es — algo dibujado encima para medir.
        paint: { 'line-color': '#5B7DBE', 'line-width': 2.5, 'line-dasharray': [2, 2] },
      });
      ready.current = true;
      draw(m, circleRef.current, label.current);
    });
    map.current = m;

    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
      center.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El círculo vigente, para que el `load` de arriba pueda dibujarlo aunque llegue después.
  const circleRef = useRef(circle);
  circleRef.current = circle;

  /*
   * Sincronizar los pines: agregar los que entraron, sacar los que se fueron, y repintar el que
   * cambió de estado. Recrearlos todos en cada cambio haría parpadear los que no se movieron.
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
      const existente = markers.current.get(p.id);
      if (existente) {
        // Sólo la clase: recrear el marcador lo haría parpadear sin haberse movido.
        existente.getElement().className = pinClass(p.picked);
        continue;
      }
      const pin = document.createElement('div');
      pin.className = pinClass(p.picked);
      /*
       * El nombre va en `title` y no en un popup: el clic ya tiene dueño —marca y desmarca—, y un
       * popup que se abre encima taparía los puntos de al lado justo mientras se elige entre ellos.
       */
      if (p.label) pin.title = p.label;
      pin.addEventListener('click', (e) => {
        // Sin esto, el clic también llega al mapa y arrastra el encuadre bajo el dedo.
        e.stopPropagation();
        click.current?.(p.id);
      });
      const marker = new Marker({ element: pin }).setLngLat([p.longitude, p.latitude]);
      marker.addTo(m);
      markers.current.set(p.id, marker);
    }
  }, [points]);

  // Encuadre: sólo cuando cambia CUÁNTOS hay. Reencuadrar en cada tilde movería el mapa bajo el dedo.
  useEffect(() => {
    const m = map.current;
    if (!m || points.length === 0) return;
    if (points.length === 1) {
      m.easeTo({ center: [points[0]!.longitude, points[0]!.latitude], zoom: 15, duration: 300 });
      return;
    }
    const bounds = new LngLatBounds();
    for (const p of points) bounds.extend([p.longitude, p.latitude] as LngLatLike);
    if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);

  /*
   * El área: el polígono y el marcador que la arrastra.
   *
   * Durante el arrastre se redibuja **acá adentro**, sin tocar el estado de React; al soltar se
   * avisa una sola vez.
   */
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    if (!circle) {
      center.current?.remove();
      center.current = null;
      label.current?.remove();
      label.current = null;
      if (ready.current) (m.getSource(AREA) as GeoJSONSource | undefined)?.setData(emptyArea());
      return;
    }

    // El rótulo del radio: se crea con el área y después sólo se mueve y se reescribe.
    if (!label.current) {
      const chip = document.createElement('div');
      chip.className =
        'pointer-events-none whitespace-nowrap rounded-full border border-k-periwinkle bg-white px-2 py-0.5 text-[11px] font-semibold text-k-periwinkle shadow';
      label.current = new Marker({ element: chip }).setLngLat([circle.longitude, circle.latitude]).addTo(m);
    }
    if (circle.label) label.current.getElement().textContent = circle.label;

    draw(m, circle, label.current);

    if (!center.current) {
      const handle = document.createElement('div');
      handle.className =
        'flex h-6 w-6 cursor-grab items-center justify-center rounded-full border-2 border-white bg-k-periwinkle text-[11px] text-white shadow active:cursor-grabbing';
      handle.textContent = '✥';
      handle.setAttribute('aria-hidden', 'true');
      center.current = new Marker({ element: handle, draggable: true })
        .setLngLat([circle.longitude, circle.latitude])
        .addTo(m);

      center.current.on('drag', () => {
        const { lat, lng } = center.current!.getLngLat();
        // Sin pasar por React: el polígono y su rótulo se mueven mientras el dedo está abajo.
        draw(m, { latitude: lat, longitude: lng, radiusKm: circleRef.current?.radiusKm ?? 1 }, label.current);
      });
      center.current.on('dragend', () => {
        const { lat, lng } = center.current!.getLngLat();
        notify.current?.({ latitude: lat, longitude: lng });
      });
    } else {
      center.current.setLngLat([circle.longitude, circle.latitude]);
    }
  }, [circle]);

  // El alto cambia al agrandar: MapLibre no se entera solo de que su caja creció.
  useEffect(() => {
    map.current?.resize();
  }, [height]);

  return (
    <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-2xl border border-k-border" />
  );
}

const AREA = 'plan-area';

function pinClass(picked?: boolean): string {
  /*
   * El elegido es más grande y del color de la marca; el disponible, un punto gris que no compite.
   *
   * `cursor-pointer` en los dos: **se puede tocar cualquiera**, y sin el cursor nadie lo descubre —
   * un punto que reacciona al clic y parece decorativo es una función que no existe.
   */
  const base = 'cursor-pointer rounded-full border-white shadow transition-all';
  return picked ? `${base} h-4 w-4 border-2 bg-k-navy` : `${base} h-2.5 w-2.5 border bg-k-muted hover:bg-k-periwinkle`;
}

function emptyArea(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * El círculo, como polígono de 64 lados.
 *
 * MapLibre no dibuja círculos en metros: un `circle-radius` va en píxeles y quedaría del mismo
 * tamaño en pantalla al alejar el zoom, mintiendo sobre el área. Un polígono en coordenadas se
 * agranda y se achica con el mapa, que es lo que un radio de dos kilómetros tiene que hacer.
 */
function draw(m: MapLibreMap, circle?: MapCircle, label?: Marker | null): void {
  const source = m.getSource(AREA) as GeoJSONSource | undefined;
  if (!source) return;
  if (!circle) return void source.setData(emptyArea());

  const points: [number, number][] = [];
  const latKm = 110.574; // un grado de latitud, en km
  const lngKm = 111.32 * Math.cos((circle.latitude * Math.PI) / 180); // el de longitud se achica hacia los polos
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    points.push([
      circle.longitude + (circle.radiusKm / lngKm) * Math.cos(a),
      circle.latitude + (circle.radiusKm / latKm) * Math.sin(a),
    ]);
  }

  source.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [points] } }],
  });

  // El rótulo va **sobre el borde**, arriba: ahí es donde se mide el radio, y en el centro se
  // pisaría con la manija de arrastre.
  label?.setLngLat([circle.longitude, circle.latitude + circle.radiusKm / latKm]);
}
