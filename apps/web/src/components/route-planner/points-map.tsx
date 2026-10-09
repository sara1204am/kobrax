'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type LngLatLike,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_ZOOM, FALLBACK_CENTER, MAP_LOCALE, MAP_STYLE, SATELLITE_ATTRIBUTION, SATELLITE_TILES } from '@/lib/map-style';
import { postJson } from '@/lib/client';
import { addLocateControl, type Here } from '../map-locate';

const SAT = 'plan-satellite';
const TO_NEXT = 'plan-to-next';
/** A pie, a paso normal: 5 km/h. Es una estimación —el motor de ruteo sólo conoce las calles para vehículo—. */
const WALK_KMH = 5;
/** Si se movió menos que esto, el camino ya calculado sirve: el seguimiento avisa cada pocos segundos. */
const RECALC_M = 60;

/** Cómo se pinta el pin. El color es el estado de la parada; el badge del globo es otra cosa y no lo repite. */
export type PinTone = 'pending' | 'done' | 'next' | 'skipped' | 'scheduled' | 'suggestion' | 'candidate' | 'visit';

/** Una etiqueta del globo y de la lista: tinte claro, para que no se confunda con el pin (que es de color pleno). */
export interface PointBadge {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}

export const BADGE_CLASS: Record<PointBadge['tone'], string> = {
  success: 'bg-k-success-bg text-k-text',
  warning: 'bg-k-warning-bg text-k-warning-text',
  danger: 'bg-k-danger-bg text-k-danger',
  info: 'bg-k-light-bg text-k-slate',
  neutral: 'bg-k-bg text-k-text-2',
};

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
  /** La segunda línea del globo: saldo y mora, que es lo que decide si vale la pena ir. */
  detail?: string;
  /** Ya está en la ruta que se arma. Se pinta distinto de los que todavía se pueden elegir. */
  picked?: boolean;
  /**
   * En qué lugar del recorrido va, si ya está elegido.
   *
   * 🔴 Se dibuja **adentro del pin**: el orden es la mitad de lo que se decide al planificar —a qué
   * hora cae cada puerta— y sin el número el mapa muestra dónde ir pero no en qué orden.
   */
  order?: number;
  /** El estado de la parada: define el color del pin. Sin él, el pin sale como siempre (numerado, elegido o disponible). */
  tone?: PinTone;
  /** Etiquetas del globo: «Visitada», «Hora fija 10:00», «Visita agendada». */
  badges?: PointBadge[];
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
  line,
  focusId,
  onPointHover,
}: {
  points: MapPoint[];
  height: number;
  /** El recorrido por las calles (motor de ruteo). Si viene, reemplaza al trazo recto punteado. */
  line?: { latitude: number; longitude: number }[];
  /** El punto resaltado desde afuera (la fila de la lista bajo el cursor). */
  focusId?: string | null;
  /** Avisa qué punto tiene el cursor encima, para resaltar su fila. */
  onPointHover?: (id: string | null) => void;
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
  const t = useTranslations('panel.routes.planning');
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  /** Mapa de calles o imágenes satelitales. */
  const [base, setBase] = useState<'map' | 'satellite'>('map');
  const baseRef = useRef(base);
  baseRef.current = base;
  /** Los ids de las capas del estilo de calles, para apagarlas al ver el satélite. */
  const baseLayers = useRef<string[]>([]);
  /** Lo que falta desde donde está la persona hasta la próxima parada. */
  const [trip, setTrip] = useState<{ distanceKm: number; minutes: number } | null>(null);
  const hereRef = useRef<Here | null>(null);
  const asked = useRef<{ at: Here; to: string } | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
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
  const tripLine = useRef<GeoJSON.FeatureCollection | null>(null);
  const nextRef = useRef<MapPoint | undefined>(undefined);
  const hover = useRef(onPointHover);
  hover.current = onPointHover;
  const lineRef = useRef(line);
  lineRef.current = line;

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
      locale: MAP_LOCALE,
    });
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    addLocateControl(m, (h) => {
      hereRef.current = h;
      void askTrip(h, nextRef.current);
    });
    m.on('load', () => {
      /*
       * El satélite es una capa más **debajo de todo**, y al verlo se apagan las del estilo de calles. Así el selector
       * no cambia el estilo —`setStyle` borraría el área, el recorrido y todo lo que se dibuja encima— y funciona con
       * cualquier estilo de base.
       */
      baseLayers.current = m.getStyle().layers.map((l) => l.id);
      m.addSource(SAT, { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIBUTION });
      m.addLayer({ id: SAT, type: 'raster', source: SAT, layout: { visibility: 'none' } }, baseLayers.current[0]);
      applyBase(m, baseRef.current, baseLayers.current);

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

      /*
       * 🔴 El recorrido posible entre las paradas elegidas, **punteado y en línea recta**: es el
       * orden, no el camino. El camino real por las calles lo calcula OSRM y sale en la ficha de la
       * ruta una vez creada; dibujarlo continuo acá haría pasar por «va por acá» algo que sólo dice
       * «primero ésta, después ésta».
       */
      m.addSource(PATH, { type: 'geojson', data: emptyArea() });
      m.addLayer({
        id: PATH,
        type: 'line',
        source: PATH,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1A3A52', 'line-width': 2, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.7 },
      });

      // El camino real por las calles: continuo, porque ése sí es por donde se va.
      m.addSource(ROAD, { type: 'geojson', data: emptyArea() });
      m.addLayer({
        id: ROAD,
        type: 'line',
        source: ROAD,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2B5A7D', 'line-width': 4, 'line-opacity': 0.85 },
      });

      // Del punto donde está la persona hasta la próxima parada: otro color que el recorrido, para no confundirlos.
      m.addSource(TO_NEXT, { type: 'geojson', data: emptyArea() });
      m.addLayer({
        id: TO_NEXT,
        type: 'line',
        source: TO_NEXT,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7B68D6', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [1, 1.5] },
      });
      if (tripLine.current) (m.getSource(TO_NEXT) as GeoJSONSource).setData(tripLine.current);

      ready.current = true;
      draw(m, circleRef.current, label.current);
      drawRoad(m, lineRef.current);
      drawPath(m, pointsRef.current, !!lineRef.current?.length);
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

  useEffect(() => {
    const m = map.current;
    if (m && ready.current) applyBase(m, base, baseLayers.current);
  }, [base]);

  /** Lo que se busca en el mapa son los puntos que hay en él: por nombre o por el detalle (saldo, zona). */
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return points.filter((p) => `${p.label ?? ''} ${p.detail ?? ''}`.toLowerCase().includes(q)).slice(0, 6);
  }, [points, query]);

  const goTo = (p: MapPoint) => {
    map.current?.easeTo({ center: [p.longitude, p.latitude], zoom: Math.max(map.current.getZoom(), 16), duration: 400 });
    hover.current?.(p.id);
  };
  const nextStop = points.find((p) => p.tone === 'next');
  nextRef.current = nextStop;

  /**
   * El camino desde donde está la persona hasta la próxima parada. Pide el trazo por las calles a la API y lo dibuja; si
   * el motor de ruteo no contesta, el mapa sigue mostrando dónde está y simplemente no dice cuánto falta.
   */
  async function askTrip(h: Here, to: MapPoint | undefined): Promise<void> {
    const m = map.current;
    if (!to) return;
    const prev = asked.current;
    if (prev && prev.to === to.id && metersBetween(prev.at, h) < RECALC_M) return;
    asked.current = { at: h, to: to.id };
    const res = await postJson<{ geometry: { latitude: number; longitude: number }[]; distanceKm: number; minutes: number }>('/api/routes/leg', {
      from: { id: 'here', latitude: h.latitude, longitude: h.longitude },
      to: { id: to.id, latitude: to.latitude, longitude: to.longitude },
    });
    if (!res.ok || !res.data?.geometry) {
      asked.current = null;
      tripLine.current = null;
      setTrip(null);
      if (m && ready.current) (m.getSource(TO_NEXT) as GeoJSONSource | undefined)?.setData(emptyArea());
      return;
    }
    const line: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: res.data.geometry.map((p) => [p.longitude, p.latitude]) } }],
    };
    tripLine.current = line;
    setTrip({ distanceKm: res.data.distanceKm, minutes: res.data.minutes });
    if (m && ready.current) (m.getSource(TO_NEXT) as GeoJSONSource | undefined)?.setData(line);
  }

  // Si la próxima parada cambia (se registró una gestión), el camino se rehace hacia la nueva.
  useEffect(() => {
    if (hereRef.current) void askTrip(hereRef.current, nextStop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextStop?.id]);

  // Lo vigente, para que el `load` de arriba pueda dibujarlo aunque llegue después que los datos.
  const circleRef = useRef(circle);
  circleRef.current = circle;
  const pointsRef = useRef(points);
  pointsRef.current = points;

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
      const focused = p.id === focusId;
      const existente = markers.current.get(p.id);
      if (existente) {
        // Sólo el punto y el globo, no el marcador entero: recrearlo lo haría parpadear sin haberse movido.
        // El punto es el primer hijo; el padre es el área que se puede tocar.
        const hit = existente.getElement();
        const dot = hit.firstElementChild as HTMLElement | null;
        if (dot) {
          dot.className = pinClass(p, focused);
          dot.textContent = pinText(p);
        }
        hit.classList.toggle('z-40', focused);
        fillTip(hit, p, focused);
        existente.setLngLat([p.longitude, p.latitude]);
        continue;
      }

      /*
       * 🔴 **El área que responde al clic es más grande que el punto.** El disponible mide diez
       * píxeles: apuntarle exige una puntería que nadie tiene mientras compara diez deudores, y el
       * cursor recién cambiaba justo encima. El contenedor de 24 px es invisible y lleva la mano —
       * así se nota que se puede tocar **al acercarse**, no al acertar.
       *
       * 24 y no 44 (el mínimo táctil): con puntos de la misma cuadra, áreas más grandes empezarían
       * a robarse el clic entre vecinos.
       */
      /*
       * 🔴 **`hover:z-50` va en el MARCADOR, no en el globo.** Cada marcador es un elemento aparte
       * dentro del mismo contenedor, así que el globo se dibujaba debajo de los puntos que vienen
       * después en el DOM por mucho z-index que tuviera adentro: el apilado se decide entre
       * hermanos, y el hermano es el marcador entero. Al pasar por encima, ése sube y su globo va
       * con él.
       */
      const hit = document.createElement('div');
      hit.className = 'group relative flex h-6 w-6 cursor-pointer items-center justify-center hover:z-50';
      const dot = document.createElement('span');
      dot.className = pinClass(p, focused);
      dot.textContent = pinText(p);
      hit.appendChild(dot);
      fillTip(hit, p, focused);
      hit.classList.toggle('z-40', focused);

      hit.addEventListener('click', (e) => {
        // Sin esto, el clic también llega al mapa y arrastra el encuadre bajo el dedo.
        e.stopPropagation();
        click.current?.(p.id);
      });
      // El cursor sobre el pin resalta su fila en la lista: es el mismo punto visto desde dos lados.
      hit.addEventListener('mouseenter', () => hover.current?.(p.id));
      hit.addEventListener('mouseleave', () => hover.current?.(null));

      const marker = new Marker({ element: hit }).setLngLat([p.longitude, p.latitude]);
      marker.addTo(m);
      markers.current.set(p.id, marker);
    }

    if (ready.current) {
      drawRoad(m, line);
      drawPath(m, points, !!line?.length);
    }
  }, [points, focusId, line]);

  // Si el punto resaltado desde la lista queda fuera de la vista, el mapa va hacia él.
  useEffect(() => {
    const m = map.current;
    if (!m || !focusId) return;
    const p = pointsRef.current.find((x) => x.id === focusId);
    if (!p) return;
    const at: LngLatLike = [p.longitude, p.latitude];
    if (!m.getBounds().contains(at)) m.easeTo({ center: at, duration: 250 });
  }, [focusId]);

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
    <div className="relative">
      <div ref={container} style={{ height }} className="w-full overflow-hidden rounded-2xl border border-k-border" />

      {/* Los controles flotan sobre el mapa, a la izquierda: a la derecha están el zoom y la atribución. */}
      <div className="absolute left-3 top-3 z-10 flex w-64 max-w-[calc(100%-5rem)] flex-col gap-2">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder={t('mapSearch')}
            aria-label={t('mapSearch')}
            className="h-9 w-full rounded-lg border border-k-border bg-white px-3 text-[13px] text-k-text shadow outline-none focus:border-k-periwinkle"
          />
          {searchOpen && query.trim().length >= 2 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-k-border bg-white py-1 shadow-k-card">
              {found.length === 0 ? (
                <li className="px-3 py-2 text-[12px] text-k-text-2">{t('mapSearchNone')}</li>
              ) : (
                found.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      // `onMouseDown` y no `onClick`: el `blur` del campo cerraría la lista antes de que llegue el clic.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        goTo(p);
                        setSearchOpen(false);
                      }}
                      className="block w-full px-3 py-1.5 text-left hover:bg-k-bg"
                    >
                      <span className="block truncate text-[13px] font-medium text-k-text">{p.label}</span>
                      {p.detail && <span className="block truncate text-[11px] text-k-text-2">{p.detail}</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {trip && nextStop && (
          <div className="rounded-lg border border-k-border bg-white px-3 py-2 text-[12px] text-k-text-2 shadow">
            <p className="font-medium text-k-text">{t('mapToNext', { km: trip.distanceKm })}</p>
            <p className="mt-0.5 tabular-nums">
              {t('mapByVehicle', { min: trip.minutes })} · {t('mapOnFoot', { min: Math.max(1, Math.round((trip.distanceKm / WALK_KMH) * 60)) })}
            </p>
            <p className="mt-0.5 text-[11px] text-k-muted">{t('mapFootNote')}</p>
          </div>
        )}

        {nextStop && (
          <button
            type="button"
            onClick={() => goTo(nextStop)}
            className="h-9 rounded-lg border border-k-border bg-white px-3 text-left text-[13px] font-medium text-k-purple shadow hover:bg-k-highlight"
          >
            {t('mapNextStop')}
          </button>
        )}
      </div>

      <div role="group" className="absolute bottom-6 left-3 z-10 flex overflow-hidden rounded-lg border border-k-border bg-white text-[12px] font-medium shadow">
        {(['map', 'satellite'] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={base === b}
            onClick={() => setBase(b)}
            className={`h-8 px-3 ${base === b ? 'bg-k-navy text-white' : 'text-k-text-2 hover:bg-k-bg'}`}
          >
            {b === 'map' ? t('mapBaseMap') : t('mapBaseSatellite')}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Calles o satélite: se alterna la visibilidad de las capas, sin tocar el estilo. */
function applyBase(m: MapLibreMap, base: 'map' | 'satellite', layers: string[]): void {
  const sat = base === 'satellite';
  for (const id of layers) m.setLayoutProperty(id, 'visibility', sat ? 'none' : 'visible');
  m.setLayoutProperty(SAT, 'visibility', sat ? 'visible' : 'none');
}

const AREA = 'plan-area';
const PATH = 'plan-path';
const ROAD = 'plan-road';

/** El camino real por las calles, si el motor de ruteo lo dio. */
function drawRoad(m: MapLibreMap, line?: { latitude: number; longitude: number }[]): void {
  const source = m.getSource(ROAD) as GeoJSONSource | undefined;
  if (!source) return;
  const coords = (line ?? []).map((p) => [p.longitude, p.latitude] as [number, number]);
  source.setData(
    coords.length < 2
      ? emptyArea()
      : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] },
  );
}

/**
 * El recorrido posible: une las paradas **elegidas**, en su orden.
 *
 * Con menos de dos no hay recorrido que dibujar — una línea de un punto a sí mismo no dice nada. Si ya hay camino real
 * por las calles (`hasRoad`), el trazo recto sobra: se limpia para no dibujar dos recorridos encima.
 */
function drawPath(m: MapLibreMap, points: MapPoint[], hasRoad = false): void {
  const source = m.getSource(PATH) as GeoJSONSource | undefined;
  if (!source) return;

  const orden = points
    .filter((p): p is MapPoint & { order: number } => p.order != null)
    .sort((a, b) => a.order - b.order)
    .map((p) => [p.longitude, p.latitude] as [number, number]);

  source.setData(
    hasRoad || orden.length < 2
      ? emptyArea()
      : {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: orden } }],
        },
  );
}

/** El texto del pin: su número en el recorrido, o «+» si es una sugerencia. */
function pinText(p: MapPoint): string {
  if (p.tone === 'suggestion') return '+';
  return p.order ? String(p.order) : '';
}

function pinClass(p: MapPoint, focused: boolean): string {
  /*
   * El color del pin es **el estado de la parada** (visitada, pendiente, la que sigue, saltada, con visita agendada) y
   * su número, el lugar en el recorrido. Lo demás —«Hora fija», «Ayuda», la fuente— va en el globo, en etiquetas de tinte
   * claro: así lo que se lee en el pin y lo que se lee en la etiqueta no se confunden.
   *
   * Los tres tamaños **crecen y se tiñen al acercarse** (`group-hover`, que dispara el área de toque de alrededor y no el
   * punto en sí): es la confirmación de que el clic va a caer ahí y no en el vecino.
   */
  const base = 'flex items-center justify-center rounded-full border-white shadow transition-all group-hover:scale-125';
  const ring = focused ? ' scale-125 ring-4 ring-k-periwinkle/40' : '';

  // Dónde se registró una visita: más chico y de otro color, no compite con la parada — la distancia entre los dos es lo que se mira.
  if (p.tone === 'visit') return `${base} h-3 w-3 border-2 bg-k-purple${ring}`;
  if (p.tone === 'suggestion') {
    return `${base} h-5 w-5 border-2 border-k-warning bg-white text-[13px] font-bold leading-none text-k-warning-text group-hover:bg-k-warning-bg${ring}`;
  }
  if (p.order) {
    const fill =
      p.tone === 'done'
        ? 'bg-k-success group-hover:bg-k-success'
        : p.tone === 'next'
          ? 'bg-k-purple group-hover:bg-k-purple'
          : p.tone === 'skipped'
            ? 'bg-k-muted group-hover:bg-k-muted'
            : 'bg-k-navy group-hover:bg-k-slate';
    // La que tiene una visita agendada lleva un aro: es un compromiso, no sólo una parada.
    const agenda = p.tone === 'scheduled' ? ' ring-2 ring-k-warning' : '';
    return `${base} h-6 w-6 border-2 text-[11px] font-semibold text-white ${fill}${agenda}${ring}`;
  }
  return p.picked
    ? `${base} h-4 w-4 border-2 bg-k-navy group-hover:bg-k-slate${ring}`
    : `${base} h-2.5 w-2.5 border bg-k-muted group-hover:bg-k-periwinkle group-hover:scale-150${ring}`;
}

/**
 * El globo de un pin: nombre, detalle y etiquetas. Se rehace al repintar —cambia el estado de la parada, llega su hora—
 * y **no recibe eventos**: si los recibiera, taparía al punto de al lado y el clic caería en el globo y no en el vecino.
 */
function fillTip(hit: HTMLElement, p: MapPoint, focused: boolean): void {
  let tip = hit.querySelector<HTMLElement>('[data-tip]');
  if (!p.label) {
    tip?.remove();
    return;
  }
  if (!tip) {
    tip = document.createElement('span');
    tip.setAttribute('data-tip', '');
    hit.appendChild(tip);
  }
  tip.className = `pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-k-border bg-white px-2.5 py-1.5 text-left shadow-k-card group-hover:block ${focused ? 'block' : 'hidden'}`;
  tip.replaceChildren();

  const name = document.createElement('span');
  name.className = 'block text-[12px] font-semibold text-k-text';
  name.textContent = p.label;
  tip.appendChild(name);

  if (p.detail) {
    const sub = document.createElement('span');
    sub.className = 'block text-[11px] text-k-text-2';
    sub.textContent = p.detail;
    tip.appendChild(sub);
  }
  if (p.badges?.length) {
    const row = document.createElement('span');
    row.className = 'mt-1 flex flex-wrap gap-1';
    for (const b of p.badges) {
      const chip = document.createElement('span');
      chip.className = `rounded-full px-2 py-0.5 text-[10px] font-medium ${BADGE_CLASS[b.tone]}`;
      chip.textContent = b.label;
      row.appendChild(chip);
    }
    tip.appendChild(row);
  }
}

/** Metros entre dos puntos (haversine): sólo para decidir si vale pedir el camino de nuevo. */
function metersBetween(a: Here, b: Here): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
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
