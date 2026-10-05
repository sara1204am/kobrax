'use client';

import { useLocale, useTranslations } from 'next-intl';
import { monthGrid, shiftMonth } from '@/lib/agenda';

/**
 * El mes chico de la izquierda: navega entre días y avisa **qué días tienen algo agendado** con un punto.
 * Los puntos salen de las gestiones del mes que la pantalla ya trajo; no hay otro pedido.
 */
export function MiniCalendar({
  day,
  today,
  withItems,
  onPickDay,
  onPickMonth,
}: {
  /** El día elegido; su mes es el que se dibuja. */
  day: string;
  today: string;
  /** Los días (`YYYY-MM-DD`) con al menos una gestión. */
  withItems: Set<string>;
  onPickDay: (iso: string) => void;
  onPickMonth: (iso: string) => void;
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const grid = monthGrid(day);
  const fmt = (o: Intl.DateTimeFormatOptions, iso: string) =>
    new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00.000Z`));

  return (
    <section aria-label={t('miniCalendar')} className="rounded-2xl border border-k-border bg-white p-4 shadow-k-card">
      <div className="mb-3 flex items-center justify-between">
        <Arrow dir="prev" label={t('previousMonth')} onClick={() => onPickMonth(shiftMonth(day, -1))} />
        <span className="text-[15px] font-semibold capitalize text-k-navy">
          {fmt({ month: 'long', year: 'numeric' }, day)}
        </span>
        <Arrow dir="next" label={t('nextMonth')} onClick={() => onPickMonth(shiftMonth(day, 1))} />
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {grid.slice(0, 7).map((iso) => (
          <span key={`h${iso}`} className="pb-1 text-[11px] capitalize text-k-muted">
            {fmt({ weekday: 'short' }, iso).replace('.', '')}
          </span>
        ))}
        {grid.map((iso) => {
          const selected = iso === day;
          const esHoy = iso === today;
          const delMes = iso.slice(0, 7) === day.slice(0, 7);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPickDay(iso)}
              aria-label={fmt({ weekday: 'long', day: 'numeric', month: 'long' }, iso)}
              aria-current={esHoy ? 'date' : undefined}
              aria-pressed={selected}
              className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-[13px] tabular-nums transition-colors ${
                selected
                  ? 'bg-k-navy font-semibold text-white'
                  : `${delMes ? 'text-k-text' : 'text-k-muted'} hover:bg-k-info-bg ${esHoy ? 'font-semibold ring-1 ring-inset ring-k-periwinkle' : ''}`
              }`}
            >
              {Number(iso.slice(8, 10))}
              {withItems.has(iso) && (
                <span
                  data-testid="day-dot"
                  aria-hidden
                  className={`absolute bottom-1 h-1 w-1 rounded-full ${selected ? 'bg-white' : 'bg-k-periwinkle'}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Arrow({ dir, label, onClick }: { dir: 'prev' | 'next'; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-k-text-2 hover:bg-k-bg"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir === 'prev' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
      </svg>
    </button>
  );
}
