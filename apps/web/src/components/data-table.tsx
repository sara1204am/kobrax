'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface Column<T> {
  /** Clave del orden — la que viaja a la API en `?sort=`. */
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
}

/** El `meta` del sobre `{data, meta, error}`, tal cual lo devuelve la API. */
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * Tabla de listado.
 *
 * **El orden y la página viven en la URL, no en un estado interno.** Así la vista se comparte
 * por link, el botón «atrás» del navegador funciona y el server component de la pantalla lee
 * los mismos `searchParams` para pedirle a la API la página que toca: no hay dos verdades
 * sobre en qué página estamos.
 *
 * En pantalla chica la tabla **scrollea dentro de su caja**; la página nunca se va de costado.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  meta,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  meta: PageMeta;
  empty: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useTranslations('panel.table');

  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';

  function go(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggleSort(column: Column<T>) {
    // El primer clic usa el sentido natural de la columna; a partir de ahí, alterna.
    const next =
      sort === column.key ? (dir === 'asc' ? 'desc' : 'asc') : (column.defaultDir ?? 'asc');
    // Volver a la página 1: ordenar de nuevo cambia qué filas caen en cada página, y quedarse
    // en la 7 mostraría un pedazo del medio de una lista que la persona no vio empezar.
    go({ sort: column.key, dir: next, page: '1' });
  }

  if (rows.length === 0) return <>{empty}</>;

  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="overflow-hidden rounded-2xl border border-k-border bg-white">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-k-border bg-k-bg text-left">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort === column.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={`px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-k-text-2 ${
                    column.numeric ? 'text-right' : ''
                  }`}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className="inline-flex items-center gap-1 uppercase hover:text-k-text"
                    >
                      {column.header}
                      <span aria-hidden className={sort === column.key ? 'text-k-purple' : 'text-k-muted'}>
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
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-k-border last:border-0 hover:bg-k-bg">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 text-k-text ${column.numeric ? 'text-right tabular-nums' : ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta.pages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-k-border px-4 py-3">
          <p className="text-[13px] text-k-text-2">{t('range', { from, to, total: meta.total })}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => go({ page: String(meta.page - 1) })}
              disabled={meta.page <= 1}
              className="min-h-[36px] rounded-lg border border-k-border px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-40"
            >
              {t('previous')}
            </button>
            <button
              type="button"
              onClick={() => go({ page: String(meta.page + 1) })}
              disabled={meta.page >= meta.pages}
              className="min-h-[36px] rounded-lg border border-k-border px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-40"
            >
              {t('next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
