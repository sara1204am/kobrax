'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CaseListItem } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { money } from '@/lib/format';
import { sortAvailable, type LocalSort } from '@/lib/plan';

/**
 * La mora que se puede sumar a una ruta: **una fila por deudor, con lo que decide si vale ir**.
 *
 * 🔴 Vive en `components/` porque la usan las dos pantallas que arman una ruta —la que la crea y la
 * que la edita—: es la misma lista, la misma decisión y las mismas columnas.
 *
 * El orden se resuelve por dos caminos, y no es un capricho: **saldo y mora las ordena el servidor**
 * (sobre toda la mora, no sobre las cien que vinieron), y **deudor, zona y ubicación acá**, que es
 * correcto porque esta lista **no pagina**: lo que llegó es lo que se ve y lo que se puede elegir.
 */
export function AvailableList({
  rows,
  picked,
  onToggle,
  collectorId,
  emptyTitle,
  emptyText,
  remoteSort,
  remoteDir,
  onSortRemote,
}: {
  rows: CaseListItem[];
  picked: string[];
  onToggle: (id: string) => void;
  /** Para quién se arma: las filas de otro se marcan como ayuda. Sin esto, no se marca ninguna. */
  collectorId?: string;
  emptyTitle: string;
  emptyText: string;
  remoteSort?: string | null;
  remoteDir?: 'asc' | 'desc';
  /** Qué hacer cuando tocan una columna que el servidor sabe ordenar. */
  onSortRemote?: (key: 'balance' | 'daysPastDue') => void;
}) {
  const t = useTranslations('panel.routes.planning');
  const [localSort, setLocalSort] = useState<{ key: LocalSort; dir: 'asc' | 'desc' } | null>(null);

  const filas = useMemo(
    () => (localSort ? sortAvailable(rows, localSort.key, localSort.dir) : rows),
    [rows, localSort],
  );

  function sortLocal(key: LocalSort) {
    setLocalSort((prev) => ({ key, dir: prev?.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  }

  function sortRemote(key: 'balance' | 'daysPastDue') {
    setLocalSort(null);
    onSortRemote?.(key);
  }

  if (filas.length === 0) return <EmptyState title={emptyTitle} text={emptyText} />;

  return (
    <div className="overflow-hidden rounded-xl border border-k-border">
      {/* Con seis datos por fila, sin rótulos hay que adivinar cuál es cuál. Los anchos son los
          mismos que abajo: si se cambia uno, se cambian los dos. */}
      <div className="flex items-center gap-x-4 border-b border-k-border bg-k-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
        <span className="w-4" aria-hidden />
        <Th className="min-w-[180px] flex-1" onClick={() => sortLocal('client')} active={localSort?.key === 'client'} dir={localSort?.dir}>
          {t('cols.client')}
        </Th>
        <Th
          className="w-28 justify-end"
          onClick={() => sortRemote('balance')}
          active={!localSort && remoteSort === 'balance'}
          dir={remoteDir}
          disabled={!onSortRemote}
        >
          {t('cols.balance')}
        </Th>
        <Th
          className="w-24 justify-end"
          onClick={() => sortRemote('daysPastDue')}
          active={!localSort && remoteSort === 'daysPastDue'}
          dir={remoteDir}
          disabled={!onSortRemote}
        >
          {t('cols.dpd')}
        </Th>
        <Th className="w-28" onClick={() => sortLocal('zone')} active={localSort?.key === 'zone'} dir={localSort?.dir}>
          {t('cols.zone')}
        </Th>
        <Th className="w-40" onClick={() => sortLocal('coords')} active={localSort?.key === 'coords'} dir={localSort?.dir}>
          {t('cols.coords')}
        </Th>
      </div>

      {/*
       * 🔴 **Veinte filas y de ahí, scroll adentro.** Con cien deudores la página se hacía
       * interminable y el botón de confirmar quedaba abajo de todo: se marcaba a ciegas. El tope
       * también mira la ventana (`70vh`): en una laptop chica, veinte filas fijas serían más altas
       * que la pantalla y el scroll de adentro no serviría de nada.
       */}
      <ul className="max-h-[min(55rem,70vh)] divide-y divide-k-border overflow-y-auto">
        {filas.map((c) => {
          const marcado = picked.includes(c.id);
          const ajeno = collectorId != null && c.assigneeId != null && c.assigneeId !== collectorId;
          // La primera es la principal: la misma que va al mapa, para que la fila y el pin hablen
          // del mismo lugar.
          const loc = c.locations?.[0];
          return (
            <li key={c.id}>
              <label
                className={`flex cursor-pointer items-center gap-x-4 px-4 py-3 hover:bg-k-bg ${marcado ? 'bg-k-highlight' : ''}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-k-purple"
                  checked={marcado}
                  onChange={() => onToggle(c.id)}
                />
                <span className="min-w-[180px] flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-k-text">{c.clientName ?? '—'}</span>
                    {/* Se dice cuándo la parada es AYUDA a otro: el dueño del caso no cambia, sólo
                        esta jornada la cubre otro. */}
                    {ajeno && <Badge tone="warning">{t('help')}</Badge>}
                  </span>
                  <span className="block truncate text-[12px] text-k-muted">{loc?.address ?? t('noAddress')}</span>
                </span>
                <span className="w-28 shrink-0 text-right text-[14px] tabular-nums text-k-text">
                  {money(c.amount, c.currency ?? 'BOB')}
                </span>
                <span className="w-24 shrink-0 text-right text-[13px] tabular-nums text-k-danger">
                  {c.daysPastDue ? t('days', { n: c.daysPastDue }) : '—'}
                </span>
                <span className="w-28 shrink-0 truncate text-[13px] text-k-text-2">{c.zone ?? '—'}</span>
                {/* Las coordenadas van completas: son las que se copian a un GPS o se comparten por
                    mensaje, así que redondearlas a la vista las volvería inservibles. */}
                <span className="w-40 shrink-0 text-[12px] tabular-nums text-k-muted">
                  {loc ? `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` : t('noCoords')}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Un rótulo de columna que ordena.
 *
 * La flecha se dibuja **sólo en la columna activa**: una en cada encabezado no dice cuál manda. Y
 * `aria-sort` lo anuncia, que es lo único que tiene un lector de pantalla para saberlo.
 */
function Th({
  children,
  className,
  onClick,
  active,
  dir,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  onClick: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
  disabled?: boolean;
}) {
  return (
    <span className={className} role="columnheader" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1 uppercase hover:text-k-text disabled:cursor-default disabled:hover:text-k-text-2 ${
          className?.includes('justify-end') ? 'w-full justify-end' : ''
        }`}
      >
        {children}
        {!disabled && (
          <span aria-hidden className={active ? 'text-k-periwinkle' : 'text-k-muted'}>
            {active && dir === 'desc' ? '↓' : '↑'}
          </span>
        )}
      </button>
    </span>
  );
}
