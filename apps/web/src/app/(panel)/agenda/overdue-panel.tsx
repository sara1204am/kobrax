'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AgendaListItem } from '@kobrax/shared';
import { date as fmtDate } from '@/lib/format';
import type { AgendaEvents } from './agenda-screen';

/** Cuántas se muestran plegado. Dos: las que se pueden mirar sin dejar de ver el día. */
const PREVIEW = 2;

/**
 * Lo vencido, arriba del día.
 *
 * 🔴 **Plegado por defecto, y con las dos más viejas a la vista.** Ciento noventa y seis vencidas
 * abiertas empujan el día de hoy fuera de la pantalla: quien entra a trabajar vería primero la deuda
 * de las semanas pasadas y tendría que scrollear para llegar a lo que tiene que hacer ahora. Pero un
 * contador solo tampoco sirve —«196 vencidas» no dice a quién—, así que se asoman dos.
 *
 * 🔴 **El criterio de «las más críticas» es la ANTIGÜEDAD**, no el monto: la agenda no conoce
 * montos (`AgendaListItem` no los trae), y ordenar por algo que no está sería inventarlo. La que
 * lleva más tiempo esperando va primero, que además es la que más se enfría.
 *
 * Sin vencidas no se dibuja nada. Un cartel que diga «no hay vencidas» ocupa el lugar de lo que sí
 * hay que hacer para dar una noticia que se nota igual por ausencia.
 */
export function OverduePanel({
  items,
  total,
  events,
}: {
  /** Las que trajo el servidor, ya ordenadas de más vieja a más nueva. */
  items: AgendaListItem[];
  /** Cuántas hay de verdad — `items` es sólo la primera página. */
  total: number;
  events: AgendaEvents;
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const [abierto, setAbierto] = useState(false);

  if (total === 0) return null;
  const visibles = abierto ? items : items.slice(0, PREVIEW);

  return (
    <section
      aria-label={t('overdue.title')}
      className="mb-4 overflow-hidden rounded-xl border border-k-danger bg-k-danger-bg"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <span aria-hidden className="text-[15px]">⚠</span>
        <span className="text-[14px] font-semibold text-k-danger">{t('overdue.count', { n: total })}</span>
        <span className="text-[13px] text-k-danger">{t('overdue.text')}</span>
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="ml-auto text-[13px] font-medium text-k-danger underline-offset-2 hover:underline"
        >
          {abierto ? t('overdue.collapse') : t('overdue.expand', { n: total })}
        </button>
      </div>

      {/*
       * Scroll adentro y no en la página: abierta con ciento noventa y seis, la lista empujaría el
       * día tres pantallas hacia abajo y volver arriba sería un viaje.
       */}
      <ul
        className={`divide-y divide-k-danger/15 border-t border-k-danger/20 bg-white/60 ${
          abierto ? 'max-h-[320px] overflow-y-auto' : ''
        }`}
      >
        {visibles.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => events.onViewRequest(item.id)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-k-text">{item.clientName ?? '—'}</span>
                <span className="block truncate text-[12px] text-k-text-2">{t(`type.${item.type}`)}</span>
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-k-danger">
                {fmtDate(item.scheduledDate, locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Plegado sólo se ven dos: se dice cuántas quedan en vez de dejar creer que son todas. */}
      {!abierto && total > visibles.length && (
        <p className="px-4 py-2 text-[12px] text-k-danger">{t('overdue.more', { n: total - visibles.length })}</p>
      )}
    </section>
  );
}
