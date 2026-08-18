import { ROUTE_SORTS, RouteStatus, RouteStopStatus, type ResultCategory, type RouteItem } from '@kobrax/shared';
import { PAGE_SIZES } from './table-prefs';
import { presetRange } from './dashboard';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * El color de cada categoría del resumen. Es el mismo mapa que el móvil, pero **no se promueve**:
 * un color es presentación, y cada app tiene su paleta. Lo que sí se comparte es `categoryOf`, que
 * decide en qué categoría cae cada resultado.
 */
export const CATEGORY_TONE: Record<ResultCategory, Tone> = {
  COLLECTED: 'success',
  PROMISED: 'warning',
  NO_ANSWER: 'danger',
  UNREACHABLE: 'neutral',
  OTHER: 'neutral',
};

/**
 * El color del estado de una ruta. **Cancelada no es roja**: no salió mal, no salió. El rojo del
 * panel está reservado para lo que hay que atender.
 */
export const ROUTE_STATUS_TONE: Record<RouteStatus, Tone> = {
  [RouteStatus.PLANNED]: 'neutral',
  [RouteStatus.IN_PROGRESS]: 'warning',
  [RouteStatus.COMPLETED]: 'success',
  [RouteStatus.CANCELLED]: 'neutral',
};

export const STOP_STATUS_TONE: Record<RouteStopStatus, Tone> = {
  [RouteStopStatus.PENDING]: 'neutral',
  [RouteStopStatus.IN_ROUTE]: 'warning',
  [RouteStopStatus.VISITED]: 'success',
  // Salteada no es un error: el cobrador decidió no ir. Pero deja la parada sin gestionar.
  [RouteStopStatus.SKIPPED]: 'warning',
};

/** Lo que la pantalla de Rutas sabe leer de la URL. Las claves son las que escribe el `DataTable`. */
export interface RouteParams {
  /** `planificacion` prepara el trabajo; `historial` (el default) consulta el que ya pasó. */
  modo?: string;
  /** Dentro del historial: `dia` (el default) o `periodo`. */
  vista?: string;
  date?: string;
  /** El rango del período, inclusivo. Sólo se leen en `vista=periodo`. */
  from?: string;
  to?: string;
  collectorId?: string;
  status?: string;
  /** `date` · `collector` · `status`, las que la API sabe ordenar (`ROUTE_SORTS`). */
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

export type RouteMode = 'historial' | 'planificacion';
export type RouteView = 'dia' | 'periodo';

/**
 * Qué se está mirando, leído de la URL.
 *
 * 🔴 **El historial y el día son los defaults, y no es un detalle**: la pantalla se abre veinte
 * veces al día para ver el trabajo de hoy. Cualquier valor que no reconozca cae ahí en vez de dejar
 * la pantalla en blanco.
 */
export function routeMode(params: RouteParams): RouteMode {
  return params.modo === 'planificacion' ? 'planificacion' : 'historial';
}

export function routeView(params: RouteParams): RouteView {
  return params.vista === 'periodo' ? 'periodo' : 'dia';
}

/** Cuántas rutas por página si nadie eligió otra cosa. Un día tiene una ruta por cobrador. */
export const DEFAULT_PAGE_SIZE = 25;

/** El tamaño de página pedido, o el default. Un valor inventado es un 400 de la API, no una opción. */
export function routeLimit(params: RouteParams): number {
  return PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : DEFAULT_PAGE_SIZE;
}

/**
 * La query para `GET /routes`.
 *
 * ⚠️ **El listado no trae las paradas** (sólo `GET /routes/:id` las incluye), así que la tabla no
 * puede mostrar avance ni recaudado: `routeProgress` sobre una ruta sin paradas daría «0 de 0»,
 * que es mentira y no un cero. Eso vive en el detalle.
 *
 * Tampoco acepta `?sort=`: ordena por fecha planificada descendente y punto. Por eso ninguna
 * columna es ordenable — una flecha que no ordena nada es peor que no tenerla.
 *
 * 🔴 **`status` y `collectorId` se validan antes de viajar**: el DTO de la API los valida como enum
 * y como uuid, y un valor inventado en la URL —o una preferencia guardada de cuando el cobrador
 * todavía estaba activo— devolvería 400 y dejaría la pantalla entera sin rutas.
 */
export function routeQuery(params: RouteParams & { period?: { from: string; to: string } }): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ page: String(page), limit: String(routeLimit(params)) });
  /*
   * O un día, o un rango — nunca los dos. La API le da prioridad al día (es lo que pide el
   * teléfono), así que mandar ambos desde el período devolvería una sola jornada y la pantalla
   * mostraría una semana vacía sin decir por qué.
   */
  if (params.period) {
    query.set('from', params.period.from);
    query.set('to', params.period.to);
  } else if (params.date) {
    query.set('date', params.date);
  }
  if (params.collectorId && IS_UUID.test(params.collectorId)) query.set('collectorId', params.collectorId);
  if (params.status && params.status in ROUTE_STATUS_TONE) query.set('status', params.status);

  /*
   * El orden lo resuelve el SERVIDOR, como en cartera y mora: ordenar acá ordenaría las 25 filas de
   * la página y dejaría al resto del período donde estaba. Una clave que la API no conozca **no
   * viaja**: caería a su orden por defecto y la tabla dibujaría una flecha sobre una columna que no
   * ordenó nada.
   */
  if (params.sort && (ROUTE_SORTS as readonly string[]).includes(params.sort)) {
    query.set('sort', params.sort);
    query.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  }
  return query;
}

const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El período que se está mirando: lo que hay en la URL, o **la última semana** si no hay nada.
 *
 * Los presets salen de `lib/dashboard` (`d7` = siete días contando hoy): la regla de qué es «esta
 * semana» ya estaba escrita y probada ahí, y tener dos definiciones de lo mismo es cómo terminan
 * dos pantallas contestando distinto a la misma pregunta.
 */
export function routePeriod(params: RouteParams, today = new Date()): { from: string; to: string } {
  const fallback = presetRange('d7', today);
  const from = params.from && IS_DAY.test(params.from) ? params.from : fallback.from;
  const to = params.to && IS_DAY.test(params.to) ? params.to : fallback.to;
  // Al revés no es un rango: si alguien edita la URL, se ordena en vez de devolver cero rutas.
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Lo que hizo un cobrador en el período. Todo sale de las rutas: no hay endpoint que agregue esto. */
export interface CollectorWork {
  collectorId: string;
  /** Días con al menos una ruta. No es «días trabajados»: una ruta armada y no salida cuenta igual. */
  days: number;
  routes: number;
  /** Paradas planificadas en el período. */
  stops: number;
  /** Paradas visitadas. */
  done: number;
  /**
   * Paradas que quedaron sin visitar.
   *
   * 🔴 Se llama **sin gestionar** y no «no realizadas» a propósito: en un período que incluye hoy o
   * mañana, una parada sin visitar no es un incumplimiento — todavía no le tocaba. La palabra dice
   * lo que el dato sabe, y ni una sílaba más.
   */
  pending: number;
}

/**
 * Qué hizo cada cobrador en el período.
 *
 * 🔴 **Se agrega acá, en la web, y es una decisión con techo.** La API no tiene ninguna lectura que
 * agregue paradas por persona (`collector-performance` agrega casos y plata, no paradas), y sumar
 * rutas de un período es una cuenta de dos líneas: el endpoint nuevo llega el día que el techo
 * moleste, no antes. Quien llama tiene que pasarle **todas** las rutas del período — con una página
 * suelta, esto suma un pedazo y lo muestra como si fuera el total.
 *
 * Se ordena por paradas: la pregunta que trae a esta pantalla es quién está cargando más.
 */
export function summarizeByCollector(routes: RouteItem[]): CollectorWork[] {
  const by = new Map<string, CollectorWork & { dias: Set<string> }>();

  for (const r of routes) {
    const acc = by.get(r.collectorId) ?? {
      collectorId: r.collectorId,
      days: 0,
      routes: 0,
      stops: 0,
      done: 0,
      pending: 0,
      dias: new Set<string>(),
    };
    acc.routes += 1;
    acc.stops += r.totalCases;
    // `visitedCount` sólo lo trae el listado; sin él no se inventa un cero, se suma lo que hay.
    acc.done += r.visitedCount ?? 0;
    acc.dias.add(r.plannedDate.slice(0, 10));
    by.set(r.collectorId, acc);
  }

  return [...by.values()]
    .map(({ dias, ...w }) => ({ ...w, days: dias.size, pending: Math.max(0, w.stops - w.done) }))
    .sort((a, b) => b.stops - a.stops || a.collectorId.localeCompare(b.collectorId));
}

/** Los totales del período, para la línea de indicadores. */
export function totalWork(rows: CollectorWork[]): { collectors: number; stops: number; done: number; pending: number } {
  return {
    collectors: rows.length,
    stops: rows.reduce((s, r) => s + r.stops, 0),
    done: rows.reduce((s, r) => s + r.done, 0),
    pending: rows.reduce((s, r) => s + r.pending, 0),
  };
}

/**
 * ¿Hay algún filtro puesto, además del día?
 *
 * El día **no cuenta**: siempre hay uno, así que si contara, el vacío diría siempre «no hay
 * resultados con esos filtros» en vez de «no hubo rutas ese día», que es lo que de verdad pasó.
 */
export function hasRouteFilters(params: RouteParams): boolean {
  return Boolean(params.collectorId || params.status);
}
