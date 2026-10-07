'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AgendaListItem } from '@kobrax/shared';
import { longDay, shiftDay, weekOf } from '@/lib/agenda';
import { AgendaRow } from './agenda-row';
import type { AgendaEvents } from './agenda-screen';

/**
 * La semana (lunes a domingo): cada día con sus gestiones, de corrido.
 *
 * Es el punto medio entre el día —lo que se hace hoy— y el mes —cuántas hay cada día—: sirve para ver si la semana
 * está pareja o si el jueves quedó cargado. Sale de las mismas gestiones que ya trae el mes (la semana siempre cae
 * dentro de su grilla), así que no pide nada nuevo al servidor.
 */
export function WeekPanel({
  day,
  today,
  items,
  events,
  onPickDay,
  onOpenDay,
}: {
  day: string;
  today: string;
  /** Las del mes visible, ya filtradas. */
  items: AgendaListItem[];
  events: AgendaEvents;
  /** Cambia de semana sin salir de esta vista. */
  onPickDay: (iso: string) => void;
  /** Abre ese día en la vista Día. */
  onOpenDay: (iso: string) => void;
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const days = weekOf(day);

  const byDay = new Map<string, AgendaListItem[]>(days.map((d) => [d, []]));
  for (const item of items) byDay.get(item.scheduledDate.slice(0, 10))?.push(item);
  // Las de hora fija por hora, y las de franja después, por orden de carga.
  const order = (a: AgendaListItem, b: AgendaListItem): number =>
    (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99') || a.createdAt.localeCompare(b.createdAt);

  const step =
    'flex h-9 w-9 items-center justify-center rounded-lg border border-k-border bg-white text-k-text-2 hover:bg-k-bg';

  return (
    <section className="rounded-2xl border border-k-border bg-white p-3 shadow-k-card sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" aria-label={t('week.previous')} onClick={() => onPickDay(shiftDay(day, -7))} className={step}>
          ‹
        </button>
        <h2 className="min-w-0 text-[18px] font-semibold text-k-navy">
          {longDay(days[0]!, locale)} – {longDay(days[6]!, locale)}
        </h2>
        <button type="button" aria-label={t('week.next')} onClick={() => onPickDay(shiftDay(day, 7))} className={step}>
          ›
        </button>
        <button
          type="button"
          onClick={() => onPickDay(today)}
          disabled={days.includes(today)}
          className="h-9 rounded-lg border border-k-border bg-white px-4 text-[13px] font-medium text-k-periwinkle hover:bg-k-bg disabled:opacity-50"
        >
          {t('today')}
        </button>
      </div>

      <div className="space-y-3">
        {days.map((d) => {
          const list = (byDay.get(d) ?? []).sort(order);
          const isToday = d === today;
          return (
            <div key={d} className={`overflow-hidden rounded-xl border ${isToday ? 'border-k-periwinkle' : 'border-k-border'}`}>
              <button
                type="button"
                onClick={() => onOpenDay(d)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[14px] font-semibold ${
                  isToday ? 'bg-k-info-bg text-k-navy' : 'bg-k-bg text-k-text'
                } hover:brightness-95`}
              >
                <span>{longDay(d, locale)}</span>
                {isToday && <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-k-periwinkle">{t('today')}</span>}
                <span className="ml-auto text-[12px] font-normal text-k-text-2">{t('week.count', { n: list.length })}</span>
              </button>
              {list.length > 0 && (
                <ul>
                  {list.map((item) => (
                    <AgendaRow key={item.id} item={item} events={events} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
