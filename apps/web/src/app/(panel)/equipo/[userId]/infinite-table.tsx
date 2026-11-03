'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CursorPage } from '@kobrax/shared';

export interface InfiniteColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

/**
 * Tabla que **pide la página siguiente al llegar al final** de su propio scroll. Para listas que crecen sin tope (accesos,
 * actividad): paginar con botones en miles de filas obliga a elegir una página a ciegas, y traerlas todas rompe la pantalla.
 *
 * - La primera página llega del servidor (`initial`): la pantalla no abre vacía ni parpadea.
 * - El cursor es el instante de la última fila; una fila que cae justo en el borde puede venir dos veces y se descarta por `id`.
 * - Si cambia el período (otra consulta), el padre le cambia la `key` y la tabla arranca de cero.
 * - Un fallo de red no pierde lo ya cargado: queda un «Reintentar» al pie en vez de dejar la lista rota.
 */
export function InfiniteTable<T extends { id: string }>({
  initial,
  endpoint,
  columns,
  minWidth = 640,
}: {
  initial: CursorPage<T>;
  /** URL de la página siguiente **sin** el cursor; puede traer su propia query (`?days=30`). */
  endpoint: string;
  columns: InfiniteColumn<T>[];
  minWidth?: number;
}) {
  const t = useTranslations('team.detail.table');
  const [items, setItems] = useState<T[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const more = useCallback(async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const res = await fetch(`${endpoint}${sep}before=${encodeURIComponent(cursor)}&limit=30`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as CursorPage<T>;
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.items.filter((r) => !seen.has(r.id))];
      });
      // Una página que no avanzó el cursor no puede dejarlo igual: se pediría en bucle.
      setCursor(page.nextCursor === cursor ? null : page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, endpoint]);

  useEffect(() => {
    const node = end.current;
    if (!node || !cursor || failed) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void more(), {
      root: box.current,
      rootMargin: '120px',
    });
    io.observe(node);
    return () => io.disconnect();
  }, [cursor, failed, more, items.length]);

  return (
    <div ref={box} className="max-h-[560px] overflow-auto rounded-xl border border-k-border">
      <table className="w-full text-[14px]" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="sticky top-0 z-10 border-b border-k-border bg-white px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-k-text-2"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-k-border last:border-0">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-3 align-top">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div ref={end} className="px-3 py-3 text-center text-[12px] text-k-text-2" aria-live="polite">
        {loading && t('loading')}
        {failed && (
          <button type="button" onClick={() => void more()} className="font-medium text-k-periwinkle hover:underline">
            {t('retry')}
          </button>
        )}
        {!loading && !failed && !cursor && items.length > 0 && t('end', { count: items.length })}
      </div>
    </div>
  );
}
