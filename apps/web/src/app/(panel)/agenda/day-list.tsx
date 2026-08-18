'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AgendaItemStatus, memberName, type AgendaListItem, type Member } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { AGENDA_STATUS_TONE, groupByAssignee, groupByHour, itemWhen } from '@/lib/agenda';
import type { AgendaEvents } from './agenda-screen';

/**
 * El color y el ícono de cada tipo de gestión.
 *
 * 🔴 **El color significa algo y no decora**: verde es ir, azul es llamar, ámbar es acordarse. Se
 * repiten en la tira semanal, en el calendario y en la fila, así que se leen sin volver a la
 * leyenda. Y nunca van solos — cada uno lleva su ícono y su palabra, porque hay quien no distingue
 * el verde del rojo.
 */
const TIPO: Record<string, { tone: 'success' | 'neutral' | 'warning'; icon: string }> = {
  VISIT: { tone: 'success', icon: '📍' },
  CALL: { tone: 'neutral', icon: '📞' },
  REMINDER: { tone: 'warning', icon: '🔔' },
  PROMISE_TO_PAY: { tone: 'warning', icon: '🤝' },
};

const iniciales = (nombre: string): string =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

/**
 * El día, como una línea de tiempo.
 *
 * 🔴 **La hora se escribe UNA vez.** Antes cada fila repetía la suya en una columna fija: un día con
 * seis gestiones a las 9 mostraba «09:00» seis veces y la columna dejaba de leerse como una línea de
 * tiempo para volverse ruido pegado a cada nombre.
 *
 * 🔴 **Las hechas se quedan, atenuadas.** Sacarlas del día haría que la lista se vacíe a medida que
 * se trabaja, y con ella la prueba de lo que se hizo: a las 6 de la tarde una jornada completa se
 * vería igual que una jornada en la que nadie salió.
 */
export function DayList({
  items,
  members,
  grouped,
  events,
  day,
}: {
  items: AgendaListItem[];
  members: Member[];
  /** Modo supervisión: se agrupa por cobrador con encabezados que se pliegan. */
  grouped: boolean;
  events: AgendaEvents;
  day: string;
}) {
  const t = useTranslations('panel.agenda');

  if (items.length === 0) {
    return (
      <EmptyState
        title={t('empty')}
        text={t('emptyText')}
        action={
          <button
            type="button"
            onClick={() => events.onCreateRequest({ date: day })}
            className="h-9 rounded-lg bg-k-navy px-4 text-[13px] font-medium text-white hover:bg-k-slate"
          >
            {t('createCta')}
          </button>
        }
      />
    );
  }

  if (!grouped) return <Timeline items={items} events={events} day={day} />;

  const nameOf = (id: string) => {
    const found = members.find((m) => m.userId === id);
    return found ? memberName(found) : undefined;
  };

  return (
    <div className="space-y-3">
      {groupByAssignee(items, nameOf, t('unassigned')).map((g) => (
        <GestorGroup key={g.assigneeId ?? 'sin'} name={g.name} items={g.items} events={events} day={day} />
      ))}
    </div>
  );
}

/**
 * Un cobrador y su día, plegable.
 *
 * 🔴 **El estado abierto/cerrado se guarda por nombre, no por posición.** Guardándolo por índice,
 * cambiar de día reordenaba los grupos y quien había cerrado el de Ana se encontraba cerrado el de
 * Luis. Vive en el navegador y dura la sesión: es preferencia de mirada, no un dato.
 */
function GestorGroup({
  name,
  items,
  events,
  day,
}: {
  name: string;
  items: AgendaListItem[];
  events: AgendaEvents;
  day: string;
}) {
  const t = useTranslations('panel.agenda');
  const [abierto, setAbierto] = useState(true);
  const hechas = items.filter((i) => i.status !== AgendaItemStatus.SCHEDULED).length;

  return (
    <section className="overflow-hidden rounded-xl border border-k-border bg-white">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-k-bg"
      >
        <span aria-hidden className={`text-k-muted transition-transform ${abierto ? 'rotate-180' : ''}`}>⌄</span>
        <span className="flex-1 text-[14px] font-medium text-k-navy">{name}</span>
        <span className="text-[13px] tabular-nums text-k-text-2">
          {t('groupSummary', { n: items.length, done: hechas })}
        </span>
      </button>
      {abierto && (
        <div className="border-t border-k-border px-4 py-3">
          <Timeline items={items} events={events} day={day} />
        </div>
      )}
    </section>
  );
}

function Timeline({ items, events, day }: { items: AgendaListItem[]; events: AgendaEvents; day: string }) {
  const t = useTranslations('panel.agenda');
  const groups = groupByHour(items, (i) => itemWhen(i, t));

  return (
    <ol className="space-y-4">
      {groups.map((g, i) => (
        <li key={`${g.when}-${i}`} className="flex gap-3 sm:gap-4">
          {/* La hora, una vez, y la línea que la baja: es lo que hace que se lea como un día. */}
          <div className="flex w-[64px] shrink-0 flex-col items-end pt-2.5">
            <span className="text-[13px] font-semibold tabular-nums text-k-navy">{g.when}</span>
            <span aria-hidden className="mt-1 w-px flex-1 bg-k-border" />
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {g.items.map((item) => (
              <Row key={item.id} item={item} events={events} />
            ))}
            {/* El hueco: agendar a esta hora sin volver a elegirla. Aparece al pasar por encima. */}
            <li>
              <button
                type="button"
                onClick={() => events.onCreateRequest({ date: day, time: g.when })}
                className="w-full rounded-lg border border-dashed border-transparent px-3 py-1.5 text-left text-[12px] text-transparent transition-colors hover:border-k-border hover:text-k-text-2 focus-visible:border-k-border focus-visible:text-k-text-2"
              >
                {t('addHere')}
              </button>
            </li>
          </ul>
        </li>
      ))}
    </ol>
  );
}

function Row({ item, events }: { item: AgendaListItem; events: AgendaEvents }) {
  const t = useTranslations('panel.agenda');
  const tipo = TIPO[item.type] ?? { tone: 'neutral' as const, icon: '•' };
  const hecha = item.status !== AgendaItemStatus.SCHEDULED;
  const nombre = item.clientName ?? '—';

  return (
    <li
      className={`group flex items-center gap-3 rounded-xl border border-k-border px-3 py-2.5 transition-colors hover:bg-k-bg ${
        hecha ? 'opacity-60' : 'bg-white'
      }`}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-k-highlight text-[12px] font-semibold text-k-periwinkle"
      >
        {iniciales(nombre) || '—'}
      </span>

      <button
        type="button"
        onClick={() => events.onViewRequest(item.id)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-[14px] font-medium text-k-text">{nombre}</span>
        <span className="block truncate text-[12px] text-k-text-2">
          <span aria-hidden>{tipo.icon} </span>
          {t(`type.${item.type}`)}
          {item.observations ? ` · ${item.observations}` : ''}
        </span>
      </button>

      {/* Vencida sólo si sigue pendiente: una ejecutada tarde ya no le debe nada a nadie. */}
      {item.isOverdue && !hecha && <Badge tone="danger">{t('overdueBadge')}</Badge>}
      {hecha && <Badge tone={AGENDA_STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Badge>}

      {/*
       * Acciones rápidas. Aparecen al pasar por encima **y al enfocar con teclado**: sólo con
       * `group-hover` quedaban fuera del alcance de quien no usa mouse.
       */}
      {!hecha && (
        <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Quick label={t('actions.call')} icon="📞" onClick={() => events.onCallRequest(item.id)} />
          <Quick label={t('actions.complete')} icon="✓" onClick={() => events.onCompleteRequest(item.id)} />
        </span>
      )}
    </li>
  );
}

function Quick({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-k-border bg-white text-[13px] hover:bg-k-highlight"
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
