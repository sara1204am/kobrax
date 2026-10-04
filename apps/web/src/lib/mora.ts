import { MORA_SORTS, isCreditSource } from '@kobrax/shared';
import { PAGE_SIZES } from './table-prefs';

/**
 * Lo que la Central de Mora sabe leer de la URL (`GET /mora`). Las claves son las que escribe el
 * `DataTable` y su panel de filtros; qué significa cada una para la API, `moraListQuery`.
 */
export interface MoraParams {
  /** Prioridad del episodio de mora abierto (códigos separados por coma). */
  priority?: string;
  /** Categoría de mora: códigos de la cuenta (`A`, `B,C`…). La API ignora un código desconocido. */
  category?: string;
  /** Responsable del crédito (principal, o quien lo cubre). */
  assigneeId?: string;
  branchId?: string;
  /** `'true'` = créditos sin responsable. Sólo lo ofrece quien reparte. */
  unassigned?: string;
  /** `'true'` = sólo castigados · `'false'` = sin los castigados. */
  writtenOff?: string;
  hasPromise?: string;
  /** Rango de días de mora. Vacío = el default de la pantalla (sólo vencidos). */
  dpdMin?: string;
  dpdMax?: string;
  balanceMin?: string;
  balanceMax?: string;
  /** `'1'` = «mostrar también los que están al día». */
  todos?: string;
  /** D7: `KOBRAX` o una fuente externa. */
  source?: string;
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

/** Cuántos créditos por página si nadie eligió otra cosa. */
export const MORA_DEFAULT_PAGE_SIZE = 25;

/**
 * El tamaño de página pedido, o el default.
 *
 * 🔴 **La tabla dibuja el selector de «por página» sola** (lo hace toda tabla con `tableId`), así que
 * la pantalla tiene que leerlo: con un `limit` fijo, elegir 100 escribía la URL, recargaba y seguían
 * llegando 25 — un control que no hace nada. Un valor inventado cae al default: la API valida
 * `limit ≤ 100` y pedir más es un 400 que deja la pantalla entera sin lista.
 */
export function moraLimit(params: MoraParams): number {
  return PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : MORA_DEFAULT_PAGE_SIZE;
}

/** Filtros de texto libre o de id que viajan tal cual. Un valor vacío **no se manda**. */
const PASSTHROUGH = ['priority', 'category', 'assigneeId', 'branchId', 'q', 'balanceMin', 'balanceMax', 'dpdMin', 'dpdMax'] as const;
/** Banderas que la API valida como `'true'`/`'false'`: cualquier otra cosa no viaja. */
const FLAGS = ['unassigned', 'writtenOff', 'hasPromise'] as const;

/** F4/08 · D2: sin SLA y con «Última gestión» sólo informativa, la API ya no ordena por estas dos. */
const DROPPED_SORTS: string[] = ['lastAction', 'slaDueAt'];

/**
 * La query para `GET /mora` a partir de lo que hay en la URL.
 *
 * 🔴 **Abre por vencidos y la API es quien lo decide**: sin `dpdMin` ni `todos`, `GET /mora` ya filtra
 * `días de mora >= 1`. Acá sólo se traduce el «incluir los que están al día» (`todos=1`) a `todos=true`;
 * mandar `dpdMin=0` sería un filtro de verdad y perdería a quien no tiene mora.
 *
 * Una fuente o una clave de orden inventadas **no viajan**: el servidor las ignora o las rechaza, y un
 * link guardado de cuando había otro filtro no puede dejar la pantalla sin lista.
 */
export function moraListQuery(params: MoraParams): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ page: String(page), limit: String(moraLimit(params)) });
  for (const key of PASSTHROUGH) {
    if (params[key]) query.set(key, params[key]!);
  }
  for (const key of FLAGS) {
    if (params[key] === 'true' || params[key] === 'false') query.set(key, params[key]!);
  }
  if (isCreditSource(params.source)) query.set('source', params.source);
  if (params.todos === '1') query.set('todos', 'true');

  // El `as` es porque `MORA_SORTS` es una tupla de literales y lo que llega es lo que había en la URL:
  // la comprobación es justamente para saber si es una de ellas.
  if (params.sort && (MORA_SORTS as readonly string[]).includes(params.sort) && !DROPPED_SORTS.includes(params.sort)) {
    query.set('sort', params.sort);
    query.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  }
  return query;
}

/**
 * ¿Hay algún filtro puesto? Decide si el vacío se cuenta como «no hay» o como «no encontré».
 *
 * El piso de mora que la pantalla pone sola **no cuenta**: es cómo abre, no algo que alguien eligió.
 * Contarlo haría que una cartera sin mora dijera «no encontré nada con esos filtros» cuando la
 * respuesta verdadera es «nadie te debe», que es una noticia distinta y mejor.
 */
export function hasMoraFilters(params: MoraParams): boolean {
  return Boolean(
    params.priority || params.category || params.assigneeId || params.branchId || params.q || params.dpdMin || params.dpdMax ||
      params.balanceMin || params.balanceMax || params.source || params.todos === '1' ||
      FLAGS.some((k) => params[k] === 'true' || params[k] === 'false'),
  );
}

/** Los formatos que la API sabe bajar (`/mora/export.csv`, `/mora/export.pdf`). Cierra el proxy a lo demás. */
export const MORA_EXPORT_FORMATS = ['csv', 'pdf'] as const;
export type MoraExportFormat = (typeof MORA_EXPORT_FORMATS)[number];

export function isMoraExportFormat(v: unknown): v is MoraExportFormat {
  return typeof v === 'string' && (MORA_EXPORT_FORMATS as readonly string[]).includes(v);
}

/**
 * La query de un export: **la misma de la lista** (`moraListQuery`) sin página ni tamaño, porque se baja todo
 * el resultado. Sale de la misma función a propósito: con una copia, el archivo y la pantalla se irían
 * separando, y «exportar lo que estoy viendo» dejaría de ser verdad sin que nada lo avise.
 */
export function moraExportQuery(params: MoraParams): URLSearchParams {
  const query = moraListQuery(params);
  query.delete('page');
  query.delete('limit');
  return query;
}
