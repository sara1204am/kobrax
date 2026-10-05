'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, type AgendaListItem, type Member } from '@kobrax/shared';
import { Select } from '@/components/ui';
import { EmptyState } from '@/components/panel-ui';
import { groupDay, longDay, shiftDay, type DaySort } from '@/lib/agenda';
import { AgendaRow } from './agenda-row';
import type { AgendaEvents } from './agenda-screen';

/**
 * El día, en el panel derecho: navegación (‹ fecha › Hoy), orden, y las gestiones en bandas.
 *
 * 🔴 **Las hechas se quedan, atenuadas.** Sacarlas haría que la lista se vacíe a medida que se trabaja, y con
 * ella la prueba de lo que se hizo.
 *
 * Por hora, cada banda es una hora en punto con cuántas gestiones tiene; las que se agendaron por franja
 * (mañana, tarde, noche) tienen su propia banda con el nombre de la franja.
 */
export function DayPanel({
  day,
  today,
  items,
  members,
  filtered,
  events,
  onPickDay,
}: {
  day: string;
  today: string;
  /** Las del día, ya filtradas. */
  items: AgendaListItem[];
  members: Member[];
  /** Hay un filtro puesto: un día vacío se explica distinto. */
  filtered: boolean;
  events: AgendaEvents;
  onPickDay: (iso: string) => void;
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const [sort, setSort] = useState<DaySort>('hour');

  const nameOf = (item: AgendaListItem): string => {
    if (item.assigneeName) return item.assigneeName;
    const found = members.find((m) => m.userId === item.assigneeId);
    return found ? memberName(found) : t('unassigned');
  };

  const groups = groupDay(items, sort, {
    slot: (slot) => (slot && t.has(`timeSlot.${slot}`) ? t(`timeSlot.${slot}`) : t('noTime')),
    noTime: t('noTime'),
    type: (type) => t(`type.${type}`),
    assignee: nameOf,
  });

  return (
    <section className="rounded-2xl border border-k-border bg-white p-3 shadow-k-card sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Step dir="prev" label={t('previousDay')} onClick={() => onPickDay(shiftDay(day, -1))} />
        <h2 className="min-w-0 text-[18px] font-semibold text-k-navy">{longDay(day, locale)}</h2>
        <Step dir="next" label={t('nextDay')} onClick={() => onPickDay(shiftDay(day, 1))} />
        <button
          type="button"
          onClick={() => onPickDay(today)}
          disabled={day === today}
          className="h-9 rounded-lg border border-k-border bg-white px-4 text-[13px] font-medium text-k-periwinkle hover:bg-k-bg disabled:opacity-50"
        >
          {t('today')}
        </button>
        <Select
          aria-label={t('sort.label')}
          value={sort}
          onChange={(e) => setSort(e.target.value as DaySort)}
          className="ml-auto h-9 w-auto min-w-[170px] text-[13px]"
        >
          <option value="hour">{t('sort.hour')}</option>
          <option value="type">{t('sort.type')}</option>
          <option value="assignee">{t('sort.assignee')}</option>
        </Select>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={filtered ? t('emptyFiltered') : t('empty')}
          text={filtered ? undefined : t('emptyText')}
          action={
            filtered ? undefined : (
              <button
                type="button"
                onClick={() => events.onCreateRequest({ date: day })}
                className="h-9 rounded-lg bg-k-navy px-4 text-[13px] font-medium text-white hover:bg-k-slate"
              >
                {t('createCta')}
              </button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="rounded-xl border border-k-border">
              <header className="flex items-baseline gap-3 rounded-t-xl bg-k-bg px-4 py-2.5">
                <h3 className="text-[14px] font-semibold tabular-nums text-k-navy">{g.label}</h3>
                <span className="text-[12px] text-k-text-2">{t('groupCount', { n: g.items.length })}</span>
              </header>
              <ul>
                {g.items.map((item) => (
                  <AgendaRow key={item.id} item={item} events={events} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function Step({ dir, label, onClick }: { dir: 'prev' | 'next'; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-k-border bg-white text-k-text-2 hover:bg-k-bg"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir === 'prev' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
      </svg>
    </button>
  );
}
