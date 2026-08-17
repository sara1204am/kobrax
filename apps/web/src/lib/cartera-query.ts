/**
 * El **adaptador de datos** de la Cartera: estado de la tabla (lo que hay en la URL) → query de la
 * API. Es el único lugar donde este dominio decide qué parámetro significa qué.
 *
 * 🔴 **Es una función pura, no un `fetch`.** Quien pide es el server component de la pantalla, como
 * en todo el panel: ningún componente cliente habla con la API. Eso deja el anti-race y los pedidos
 * duplicados resueltos por la navegación de Next —descarta la anterior sola— en vez de por un
 * `AbortController` escrito a mano, y hace que esto se pueda probar sin red y sin DOM.
 *
 * 🔴 **Un valor inventado no viaja.** Todo esto entra a la query de una API que valida: un `sort`
 * que no existe o un `dpdMin` con letras devuelven 400, y un 400 acá no rompe una columna — deja la
 * pantalla entera sin cartera. Se descarta antes de salir.
 */

/** Los que el servidor sabe ordenar. `status` NO está: ordenaría por `client_status`, que no es la columna Estado. */
export const CARTERA_SORTS = ['dpd', 'debt', 'name', 'createdAt'] as const;

/** Los tamaños que ofrece la tabla. La API valida `limit ≤ 100`; pedir más es un 400. */
export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 50;

/** Los filtros de rango: clave en la URL → clave en la API (son la misma, y así queda escrito). */
const NUMERIC_FILTERS = ['debtMin', 'debtMax', 'dpdMin', 'dpdMax', 'creditsMin', 'creditsMax'] as const;

/** Los que identifican a alguien: se validan como uuid o no viajan. */
const ID_FILTERS = ['collectorId', 'branchId'] as const;

const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El filtro de Estado, traducido.
 *
 * 🔴 **«En mora» y «Pagado» no son columnas: son preguntas sobre los agregados.** Quien debe y
 * arrastra días está en mora (`mora ≥ 1`); quien no debe nada, pagado (`deuda = 0`). Traducirlo acá
 * —y no en el SQL— es lo que evita meter la regla del semáforo adentro de la consulta y tener dos
 * definiciones de «en mora» que un día dejan de coincidir.
 */
const ESTADO: Record<string, Record<string, string>> = {
  overdue: { dpdMin: '1' },
  paid: { debtMax: '0' },
};

/** Todo lo que la Cartera considera «un filtro puesto». De acá sale el vacío-por-filtros. */
export const CARTERA_FILTER_KEYS = ['q', 'status', 'risk', 'estado', ...NUMERIC_FILTERS, ...ID_FILTERS] as const;

export function hasCarteraFilters(params: Record<string, string | undefined>): boolean {
  return CARTERA_FILTER_KEYS.some((k) => params[k]?.trim());
}

export function carteraQuery(params: Record<string, string | undefined>): URLSearchParams {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : DEFAULT_PAGE_SIZE;

  const query = new URLSearchParams({ view: 'portfolio', page: String(page), limit: String(pageSize) });

  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.status?.trim()) query.set('status', params.status.trim());
  if (params.risk?.trim()) query.set('risk', params.risk.trim());

  /*
   * El estado se aplica ANTES de los rangos escritos a mano, para que el que se tipeó gane. Si
   * alguien eligió «En mora» y además escribió «mora desde 90», lo que quiso es lo segundo — el
   * estado ya se cumple de todas formas.
   */
  const estado = params.estado?.trim();
  if (estado && ESTADO[estado]) {
    for (const [k, v] of Object.entries(ESTADO[estado]!)) query.set(k, v);
  }

  for (const key of NUMERIC_FILTERS) {
    const raw = params[key]?.trim();
    // Un campo a medio escribir («1», «-», «») no es un número: se ignora hasta que lo sea. Mandarlo
    // sería un 400 mientras la persona todavía está tipeando.
    if (raw && Number.isFinite(Number(raw)) && Number(raw) >= 0) query.set(key, String(Number(raw)));
  }
  for (const key of ID_FILTERS) {
    const raw = params[key]?.trim();
    if (raw && IS_UUID.test(raw)) query.set(key, raw);
  }

  if (params.sort && (CARTERA_SORTS as readonly string[]).includes(params.sort)) {
    query.set('sort', params.sort);
    query.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  }

  return query;
}
