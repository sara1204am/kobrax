'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dropdown, Icon } from '@/components/panel-shell';
import { FilterPanel, type FilterDef } from '@/components/data-table-filters';
import { prefsToParams, readPrefs, writePrefs } from '@/lib/table-prefs';

export interface Column<T> {
  /** Clave del orden — la que viaja a la API en `?sort=`. También identifica la columna. */
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  /**
   * Hacia dónde ordena el PRIMER clic. Default `asc`, que es lo que espera un nombre; en una
   * columna de mora o de plata el default útil es al revés — tocar «Mora» para triar y recibir
   * primero los de un día de atraso no es lo que nadie quiso.
   */
  defaultDir?: 'asc' | 'desc';
  /** Los números se leen alineados a la derecha. */
  numeric?: boolean;
  /** Centrada. Para columnas de una sola cifra o una pastilla, donde alinear a un lado se ve torcido. */
  center?: boolean;
  /** `false` = existe pero arranca escondida; se prende desde ⚙ Columnas. */
  visibleByDefault?: boolean;
}

/** El `meta` del sobre `{data, meta, error}`, tal cual lo devuelve la API. */
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** Tamaños de página. Sin 200: la API valida `limit ≤ 100` y no vale romper el contrato por una opción. */
const PAGE_SIZES = [25, 50, 100];


/**
 * Tabla de listado, genérica.
 *
 * **El estado vive en la URL, no adentro.** Orden, página, tamaño de página y filtros son
 * `searchParams`: así la vista se comparte por link, «atrás» funciona, y el server component de la
 * pantalla lee lo mismo para pedirle a la API la página que toca. No hay dos verdades.
 *
 * 🔴 **La tabla no llama a la API.** Recibe `rows` y `meta` ya resueltos por el server component;
 * lo único que hace es escribir la URL y dejar que Next vuelva a renderizar. Es lo que mantiene el
 * patrón BFF del panel —ningún componente cliente habla con la API— y de paso resuelve gratis dos
 * cosas que un fetch en el navegador obliga a escribir a mano: la respuesta vieja nunca pisa a la
 * nueva (Next descarta la navegación anterior) y no hay pedidos duplicados.
 *
 * De lo específico de cada pantalla no sabe nada: qué es una deuda, cómo se formatea un boliviano o
 * qué significa «en mora» vive en las columnas y en los filtros que le pasan.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  meta,
  empty,
  tableId,
  userId,
  noResults,
  error,
  filters,
  filtered,
  search,
  entityLabel,
  actions,
  selection,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  meta: PageMeta;
  /** Qué mostrar cuando la lista está vacía **y no hay filtros puestos**. */
  empty: ReactNode;
  /** Identifica la tabla para las preferencias. Sin él, la tabla no recuerda nada (sigue andando). */
  tableId?: string;
  userId?: string;
  /** Vacío **por culpa de los filtros**. Es otro problema: se arregla borrando el filtro. */
  noResults?: ReactNode;
  /** La API falló. Lleva su propio `[Reintentar]`. */
  error?: ReactNode;
  /** Los filtros del panel lateral. Sin ellos no hay panel ni botón que lo abra. */
  filters?: FilterDef[];
  /** ¿Hay algún filtro puesto? Lo sabe la pantalla, que es la que conoce sus claves. */
  filtered?: boolean;
  /** La barra de búsqueda ancha de arriba (`SearchBox`). */
  search?: ReactNode;
  /** El nombre de lo que se lista, en plural: «clientes», «casos». Va en el pie y en la selección. */
  entityLabel?: string;
  /**
   * La acción de la pantalla («Nuevo cliente»), a la derecha de la barra.
   *
   * Va acá y no en el encabezado de la página **porque actúa sobre esta lista**: al lado de
   * Columnas queda a la altura de la mano, sin subir la vista hasta el título para volver a bajar.
   */
  actions?: ReactNode;
  /**
   * Elegir filas para actuar sobre varias a la vez. **Opt-in**: sin esto la tabla no dibuja ni una
   * casilla, que es como sigue la cartera.
   *
   * 🔴 La selección **no se guarda en la URL ni sobrevive a cambiar de página**, y es a propósito.
   * Un «seleccioné 40 en tres páginas y aplico» necesita que la tabla recuerde filas que ya no
   * tiene a la vista, y ahí la persona aplica una acción sobre algo que no está mirando. Se
   * selecciona lo que se ve; para más, se sube el tamaño de página.
   */
  selection?: {
    /** Qué se puede hacer con lo elegido. Recibe los ids y cierra la selección cuando termina. */
    render: (ids: string[], clear: () => void) => ReactNode;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useTranslations('panel.table');
  // Refetch suave: mientras Next trae la página nueva, la tabla se atenúa en vez de desaparecer.
  // Sin esto, cada filtro parpadea la pantalla entera y se pierde el hilo de lo que se veía.
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);

  /*
   * 🔴 **Cambiar de página o de filtro borra lo elegido.** Sin esto la persona filtra, la lista se
   * renueva entera, y los ids viejos siguen seleccionados sin una sola casilla marcada en pantalla:
   * el botón dice «aplicar a 12» y no hay doce a la vista. La lista de filas es la señal más
   * confiable de que lo que se ve cambió.
   */
  const visibleIds = rows.map(rowKey).join('|');
  useEffect(() => setPicked([]), [visibleIds]);

  const pickedHere = picked.filter((id) => rows.some((r) => rowKey(r) === id));
  const allPicked = rows.length > 0 && pickedHere.length === rows.length;

  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';

  const [visible, setVisible] = useState<string[]>(() =>
    columns.filter((c) => c.visibleByDefault !== false).map((c) => c.key),
  );
  // El panel abre solo si ya hay un filtro puesto: si no, un filtro activo quedaría escondido y la
  // lista saldría corta sin que nada lo explique.
  const [panelOpen, setPanelOpen] = useState(Boolean(filtered));
  const restored = useRef(false);

  const filterKeys = useMemo(() => (filters ?? []).flatMap((f) => f.keys), [filters]);

  /*
   * 🔴 **Las preferencias sólo se aplican si la URL viene limpia.**
   *
   * Con un link compartido —o al volver con «atrás»— manda la URL: lo que alguien te pasó no puede
   * quedar pisado por lo que vos filtraste ayer. Y va con `replace`, no con `push`: empujando,
   * «atrás» devolvería a la misma pantalla sin filtros y volvería a aplicarlos, dejando el botón
   * inservible.
   */
  useEffect(() => {
    if (!tableId || !userId || restored.current) return;
    restored.current = true;
    const prefs = readPrefs(userId, tableId);
    if (!prefs) return;
    if (prefs.columns?.length) setVisible(prefs.columns.filter((k) => columns.some((c) => c.key === k)));
    if (params.toString()) return;
    const next = prefsToParams(prefs);
    if (next.toString()) router.replace(`${pathname}?${next.toString()}`);
  }, [tableId, userId, params, pathname, router, columns]);

  // Y se guardan en cada cambio, para que volver a la pantalla encuentre el mismo contexto.
  useEffect(() => {
    if (!tableId || !userId || !restored.current) return;
    const saved: Record<string, string> = {};
    for (const k of [...filterKeys, 'q']) {
      const v = params.get(k);
      if (v) saved[k] = v;
    }
    writePrefs(userId, tableId, {
      filters: saved,
      sort: sort ?? undefined,
      dir,
      pageSize: Number(params.get('pageSize')) || undefined,
      columns: visible,
    });
  }, [tableId, userId, params, filterKeys, sort, dir, visible]);

  function go(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function toggleSort(column: Column<T>) {
    // El primer clic usa el sentido natural de la columna; a partir de ahí, alterna.
    const next = sort === column.key ? (dir === 'asc' ? 'desc' : 'asc') : (column.defaultDir ?? 'asc');
    // Volver a la página 1: ordenar de nuevo cambia qué filas caen en cada página, y quedarse
    // en la 7 mostraría un pedazo del medio de una lista que la persona no vio empezar.
    go({ sort: column.key, dir: next, page: '1' });
  }

  const shown = visible.flatMap((k) => columns.find((c) => c.key === k) ?? []);

  if (error) return <>{error}</>;

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      {filters && panelOpen && (
        <FilterPanel
          defs={filters}
          params={params}
          go={go}
          onClose={() => setPanelOpen(false)}
          onClear={() => go({ ...Object.fromEntries([...filterKeys, 'q'].map((k) => [k, null])), page: '1' })}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {/* 🔴 El botón de filtros va a la IZQUIERDA, del mismo lado que el panel que abre: un
              interruptor lejos de lo que enciende obliga a buscar con la vista qué cambió. */}
          <div className="flex flex-wrap items-center gap-3">
            {filters && (
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-expanded={panelOpen}
                className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium ${
                  filtered ? 'border-k-periwinkle bg-k-highlight text-k-periwinkle' : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
                }`}
              >
                <span aria-hidden>⚟</span>
                {t('appliedFilters')}
              </button>
            )}
            {tableId && <ColumnsMenu columns={columns} visible={visible} onChange={setVisible} />}
          </div>
          {/* La acción de la pantalla, sola a la derecha: es la única que crea algo, y separarla de
              los controles de la vista evita tocarla queriendo tocar Columnas. */}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>

        {search}

        {/*
         * La barra de lo elegido. Aparece sólo con algo seleccionado y **dice cuántos son**: una
         * acción en lote sin el número al lado es donde se aplica a 40 creyendo que eran 4.
         */}
        {selection && pickedHere.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-k-periwinkle bg-k-highlight px-4 py-2.5">
            <span className="text-[13px] font-medium text-k-periwinkle">
              {t('selected', { count: pickedHere.length })}
            </span>
            <div className="flex flex-wrap items-center gap-2">{selection.render(pickedHere, () => setPicked([]))}</div>
            <button
              type="button"
              onClick={() => setPicked([])}
              className="ml-auto text-[13px] font-medium text-k-text-2 hover:underline"
            >
              {t('clearSelection')}
            </button>
          </div>
        )}

        {rows.length === 0 ? (
          <>{filtered ? (noResults ?? empty) : empty}</>
        ) : (
          <div
            className={`overflow-hidden rounded-2xl border border-k-border bg-white transition-opacity ${pending ? 'opacity-60' : ''}`}
            aria-busy={pending}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-k-border text-left">
                    {selection && (
                      <th scope="col" className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allPicked}
                          onChange={(e) => setPicked(e.target.checked ? rows.map(rowKey) : [])}
                          aria-label={t('selectAll')}
                          className="h-4 w-4 accent-k-purple"
                        />
                      </th>
                    )}
                    {shown.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={sort === column.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-k-text-2 ${
                          column.numeric ? 'text-right' : column.center ? 'text-center' : ''
                        }`}
                      >
                        {column.sortable ? (
                          <button type="button" onClick={() => toggleSort(column)} className="inline-flex items-center gap-1 uppercase hover:text-k-text">
                            {column.header}
                            <span aria-hidden className={sort === column.key ? 'text-k-periwinkle' : 'text-k-muted'}>
                              {sort === column.key && dir === 'desc' ? '↓' : '↑'}
                            </span>
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const id = rowKey(row);
                    return (
                      <tr
                        key={id}
                        className={`border-b border-k-border last:border-0 hover:bg-k-bg ${
                          picked.includes(id) ? 'bg-k-highlight' : ''
                        }`}
                      >
                        {selection && (
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={picked.includes(id)}
                              onChange={(e) =>
                                setPicked((prev) => (e.target.checked ? [...prev, id] : prev.filter((x) => x !== id)))
                              }
                              aria-label={t('selectRow')}
                              className="h-4 w-4 accent-k-purple"
                            />
                          </td>
                        )}
                        {shown.map((column) => (
                          <td
                            key={column.key}
                            className={`px-4 py-4 text-k-text ${
                              column.numeric ? 'text-right tabular-nums' : column.center ? 'text-center' : ''
                            }`}
                          >
                            {column.render(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination meta={meta} go={go} pageSizes={tableId ? PAGE_SIZES : undefined} entityLabel={entityLabel} />
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * Acá vivía la selección de filas: casilla por fila, casilla de página y la barra de «acciones en
 * lote». Se sacó entera —no escondida— porque no hay ninguna acción en lote que ofrecer: código sin
 * uso se desactualiza en silencio y engaña al que lo lee después. Vuelve con un `git revert`.
 */

/**
 * Qué columnas se ven y en qué orden.
 *
 * **Se reordena arrastrando**, con la API nativa de HTML5 —`draggable` + `onDragOver` + `onDrop`—:
 * ninguna dependencia nueva por algo que el navegador ya hace.
 *
 * 🔴 **Y también con el teclado (`Alt` + ↑/↓).** Arrastrar no existe para quien navega con teclado
 * ni para un lector de pantalla; sin la alternativa, reordenar sería una función que sólo tienen
 * algunos. El `aria-label` de cada fila la anuncia.
 *
 * El ojo dice si la columna se ve: abierto, está; tachado, no. Es la misma acción que un checkbox,
 * pero se entiende sin leer la etiqueta.
 */
function ColumnsMenu<T>({
  columns,
  visible,
  onChange,
}: {
  columns: Column<T>[];
  visible: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('panel.table');
  const [dragged, setDragged] = useState<string | null>(null);
  // Las visibles primero y en su orden; las apagadas al final, esperando que las prendan.
  const ordered = [...visible, ...columns.filter((c) => !visible.includes(c.key)).map((c) => c.key)];

  /** Mueve `key` a la posición de `target`. Sólo entre visibles: una columna apagada no tiene lugar. */
  function moveTo(key: string, target: string) {
    const from = visible.indexOf(key);
    const to = visible.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...visible];
    next.splice(from, 1);
    next.splice(to, 0, key);
    onChange(next);
  }

  function moveBy(key: string, delta: number) {
    const i = visible.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= visible.length) return;
    moveTo(key, visible[j]!);
  }

  return (
    <Dropdown
      summaryClass="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg [&::-webkit-details-marker]:hidden"
      panelClass="absolute right-0 z-20 mt-1 w-[260px] overflow-hidden rounded-xl border border-k-border bg-white py-1 shadow-k-card"
      label={
        <>
          <Icon name="grip" className="h-4 w-4" />
          {t('columns')}
        </>
      }
    >
      <ul className="list-none">
        {ordered.map((key) => {
          const column = columns.find((c) => c.key === key);
          if (!column) return null;
          const on = visible.includes(key);
          return (
            <li
              key={key}
              draggable={on}
              onDragStart={() => setDragged(key)}
              onDragEnd={() => setDragged(null)}
              // Sin el `preventDefault` el navegador no acepta la soltada: es el default de HTML5.
              onDragOver={(e) => on && e.preventDefault()}
              onDrop={() => {
                if (dragged && on) moveTo(dragged, key);
                setDragged(null);
              }}
              onKeyDown={(e) => {
                if (!on || !e.altKey) return;
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveBy(key, -1);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveBy(key, 1);
                }
              }}
              tabIndex={on ? 0 : -1}
              aria-label={on ? `${column.header} — ${t('reorderHint')}` : column.header}
              className={`flex items-center gap-2 px-2.5 py-1.5 hover:bg-k-bg focus:bg-k-bg focus:outline-none ${
                dragged === key ? 'opacity-40' : ''
              } ${on ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {on ? (
                <Icon name="grip" className="h-4 w-4 shrink-0 text-k-muted" />
              ) : (
                <span className="h-4 w-4 shrink-0" />
              )}
              <span className={`flex-1 text-[13px] ${on ? 'text-k-text' : 'text-k-muted'}`}>{column.header}</span>
              <button
                type="button"
                onClick={() => onChange(on ? visible.filter((k) => k !== key) : [...visible, key])}
                aria-pressed={on}
                aria-label={`${on ? t('hideColumn') : t('showColumn')} ${column.header}`}
                className={`shrink-0 rounded p-1 ${on ? 'text-k-periwinkle' : 'text-k-muted'} hover:bg-k-highlight`}
              >
                <Icon name={on ? 'eye' : 'eyeOff'} className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </Dropdown>
  );
}

/** Paginación con números. */
function Pagination({
  meta,
  go,
  pageSizes,
  entityLabel,
}: {
  meta: PageMeta;
  go: (changes: Record<string, string>) => void;
  /** Sin esto no se dibuja el selector: una tabla de tamaño de página fijo no puede ofrecerlo. */
  pageSizes?: number[];
  entityLabel?: string;
}) {
  const t = useTranslations('panel.table');
  const total = String(meta.total);
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  if (meta.pages <= 1 && !pageSizes) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-k-border px-4 py-3">
      <p className="text-[13px] text-k-text-2">
        {entityLabel ? t('showing', { from, to, total, entity: entityLabel }) : t('range', { from, to, total })}
      </p>

      <div className="flex items-center gap-3">
        {pageSizes && (
          <label className="flex items-center gap-1.5 text-[13px] text-k-text-2">
            {t('perPage')}
            <select
              value={meta.limit}
              onChange={(e) => go({ pageSize: e.target.value, page: '1' })}
              className="h-8 rounded-lg border border-k-border bg-white px-1.5 text-[13px] text-k-text outline-none focus:border-k-periwinkle"
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        {meta.pages > 1 && (
          <div className="flex items-center gap-1">
            <PageButton label={t('previous')} icon="‹" disabled={meta.page <= 1} onClick={() => go({ page: String(meta.page - 1) })} />
            {pageNumbers(meta.page, meta.pages).map((n, i) =>
              n === null ? (
                <span key={`gap${i}`} className="px-1 text-[13px] text-k-muted">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => go({ page: String(n) })}
                  aria-current={n === meta.page ? 'page' : undefined}
                  className={`min-h-[32px] min-w-[32px] rounded-lg px-2 text-[13px] font-medium ${
                    n === meta.page ? 'bg-k-periwinkle text-white' : 'border border-k-border text-k-text-2 hover:bg-k-bg'
                  }`}
                >
                  {n}
                </button>
              ),
            )}
            <PageButton label={t('next')} icon="›" disabled={meta.page >= meta.pages} onClick={() => go({ page: String(meta.page + 1) })} />
          </div>
        )}
      </div>
    </div>
  );
}

function PageButton({ label, icon, disabled, onClick }: { label: string; icon: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg border border-k-border text-[15px] text-k-text-2 hover:bg-k-bg disabled:opacity-40"
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}

/**
 * Los números a mostrar: primera, última, la actual y sus vecinas; `null` es el «…».
 *
 * Se exporta para poder probarlo solo: es la única parte de la paginación con aritmética, y los
 * casos que se rompen —estar en la 1, en la última, o con menos páginas que huecos— no se ven a ojo.
 */
export function pageNumbers(current: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const around = [current - 1, current, current + 1].filter((n) => n > 1 && n < pages);
  const out: (number | null)[] = [1];
  if (around[0]! > 2) out.push(null);
  out.push(...around);
  if (around[around.length - 1]! < pages - 1) out.push(null);
  out.push(pages);
  return out;
}
