/**
 * Las preferencias de una tabla, por usuario y por tabla.
 *
 * Qué se guarda y qué no: **el contexto de trabajo** (filtros, orden, tamaño de página, qué columnas
 * se ven y en qué orden). No se guarda la página: volver a una pantalla y aterrizar en la página 7
 * de un listado que cambió desde ayer no restaura nada, confunde.
 *
 * 🔴 **`version` no es decoración.** El día que cambien las columnas de una tabla, unas preferencias
 * viejas apuntarían a columnas que ya no existen y la tabla saldría vacía o rota. Con el número,
 * lo viejo se descarta y se cae a los defaults: peor experiencia por una vez, nunca una pantalla
 * que no se puede usar.
 *
 * Vive en `localStorage` porque es una preferencia del navegador, no del negocio: no hay endpoint de
 * preferencias en la API y crear uno para esto sería una tabla, un módulo y un permiso por algo que
 * ya tiene dónde vivir. Si algún día tiene que seguir a la persona entre máquinas, este archivo es
 * el único lugar a cambiar.
 */

/** Sube cuando el contenido guardado deja de ser compatible. Lo viejo se descarta solo. */
export const PREFS_VERSION = 1;

/**
 * Los tamaños de página que ofrecen las tablas. Sin 200: la API valida `limit ≤ 100` y no vale
 * romper el contrato por una opción.
 *
 * Vive acá —y no en `data-table.tsx`— porque lo necesitan los dos lados: la tabla para dibujar el
 * selector, y el adaptador de cada pantalla (un módulo de servidor) para validar lo que viene en la
 * URL antes de mandarlo. Un módulo `'use client'` no se puede leer desde un server component.
 */
export const PAGE_SIZES = [25, 50, 100];

export interface TablePrefs {
  version: number;
  /** Los filtros y la búsqueda, tal cual viajan en la URL. */
  filters: Record<string, string>;
  sort?: string;
  dir?: 'asc' | 'desc';
  pageSize?: number;
  /** Las claves de las columnas visibles, **en el orden en que se muestran**. */
  columns?: string[];
}

const key = (userId: string, tableId: string) => `tablePrefs:${userId}:${tableId}`;

/**
 * Lee las preferencias. Devuelve `null` ante cualquier duda —no hay nada, es de otra versión, o el
 * JSON está roto—, y la tabla arranca con sus defaults.
 *
 * Las «vistas guardadas» (`Mi cartera`, `Mora crítica`) que vendrán después entran acá sin migración
 * dolorosa: hoy se guarda UN objeto; mañana, un `{ views: [{name, ...}], active }` con `version: 2`,
 * y lo de hoy se descarta solo.
 */
export function readPrefs(userId: string, tableId: string): TablePrefs | null {
  try {
    const raw = localStorage.getItem(key(userId, tableId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TablePrefs;
    if (parsed?.version !== PREFS_VERSION) return null;
    // Un `filters` que no sea objeto rompería el `Object.entries` de quien lo use.
    return { ...parsed, filters: parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {} };
  } catch {
    return null;
  }
}

/** Guarda. Si el navegador no deja (modo privado, cuota llena), no pasa nada: es una preferencia. */
export function writePrefs(userId: string, tableId: string, prefs: Omit<TablePrefs, 'version'>): void {
  try {
    localStorage.setItem(key(userId, tableId), JSON.stringify({ version: PREFS_VERSION, ...prefs }));
  } catch {
    /* sin preferencias se puede trabajar; sin la tabla no */
  }
}

/**
 * Las preferencias → los parámetros de URL con los que hay que abrir la pantalla.
 *
 * Se usa **sólo cuando la URL viene sin nada de la tabla**. Si trae aunque sea un parámetro —un link
 * compartido, el botón «atrás»— manda la URL: lo que alguien te pasó no puede quedar pisado por lo
 * que vos filtraste ayer.
 */
export function prefsToParams(prefs: TablePrefs): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(prefs.filters)) if (v) params.set(k, v);
  if (prefs.sort) {
    params.set('sort', prefs.sort);
    params.set('dir', prefs.dir === 'asc' ? 'asc' : 'desc');
  }
  if (prefs.pageSize) params.set('pageSize', String(prefs.pageSize));
  return params;
}
