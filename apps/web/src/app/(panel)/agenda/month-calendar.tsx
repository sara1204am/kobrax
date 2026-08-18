'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AgendaListItem } from '@kobrax/shared';
import { itemWhen, loadByDay, monthGrid, shiftMonth } from '@/lib/agenda';
import type { AgendaEvents } from './agenda-screen';

/** Cuántas gestiones se nombran en una celda antes de resumir con «+N». */
const CHIPS = 3;

/**
 * Un día con más de esto se pinta en ámbar: no cabe en una jornada y conviene repartirlo.
 *
 * ponytail: umbral fijo. Debería salir de la configuración de la cuenta el día que dos empresas no
 * estén de acuerdo en qué es un día lleno; hoy no hay ninguna que lo haya pedido.
 */
const SOBRECARGA = 20;

const TIPO_COLOR: Record<string, string> = {
  VISIT: 'bg-k-success-bg text-k-success',
  CALL: 'bg-k-highlight text-k-periwinkle',
  REMINDER: 'bg-k-warning-bg text-k-warning-text',
  PROMISE_TO_PAY: 'bg-k-warning-bg text-k-warning-text',
};

/**
 * El mes de un vistazo.
 *
 * 🔴 **No reemplaza a la lista: contesta otra pregunta.** La lista es «qué hago hoy»; el mes es
 * «cuándo tengo hueco» y «qué semana viene cargada». Por eso cada celda cuenta y nombra un poco, y
 * cualquier click lleva de vuelta a la lista de ese día, que es donde se trabaja.
 */
export function MonthCalendar({
  month,
  today,
  items,
  onPickDay,
  onPickMonth,
  events,
}: {
  /** Cualquier día del mes que se mira. */
  month: string;
  today: string;
  /** Las gestiones del mes entero — un solo pedido con rango, no treinta y uno. */
  items: AgendaListItem[];
  onPickDay: (iso: string) => void;
  onPickMonth: (iso: string) => void;
  events: AgendaEvents;
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const grid = monthGrid(month);
  const load = loadByDay(items);

  const porDía = new Map<string, AgendaListItem[]>();
  for (const item of items) {
    const day = item.scheduledDate.slice(0, 10);
    porDía.set(day, [...(porDía.get(day) ?? []), item]);
  }

  const nombreMes = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month.slice(0, 7)}-01T00:00:00.000Z`),
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Nav label={t('previousMonth')} dir="prev" onClick={() => onPickMonth(shiftMonth(month, -1))} />
        <span className="min-w-[160px] text-[15px] font-medium capitalize text-k-navy">{nombreMes}</span>
        <Nav label={t('nextMonth')} dir="next" onClick={() => onPickMonth(shiftMonth(month, 1))} />
        <button
          type="button"
          onClick={() => onPickMonth(today)}
          className="h-9 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
        >
          {t('today')}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-k-border bg-white">
        <div className="grid grid-cols-7 border-b border-k-border">
          {grid.slice(0, 7).map((iso) => (
            <span key={`h${iso}`} className="px-2 py-2 text-center text-[11px] capitalize text-k-muted">
              {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00.000Z`))}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((iso) => (
            <Celda
              key={iso}
              iso={iso}
              today={today}
              delMes={iso.slice(0, 7) === month.slice(0, 7)}
              items={porDía.get(iso) ?? []}
              carga={load.get(iso)?.overdue ?? 0}
              onPickDay={onPickDay}
              events={events}
            />
          ))}
        </div>
      </div>

      {/* La leyenda al pie: el color es una ayuda, no la única forma de saber qué es cada cosa. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-k-text-2">
        {(['VISIT', 'CALL', 'REMINDER'] as const).map((tipo) => (
          <li key={tipo} className="flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${TIPO_COLOR[tipo]}`} />
            {t(`type.${tipo}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Celda({
  iso,
  today,
  delMes,
  items,
  carga,
  onPickDay,
  events,
}: {
  iso: string;
  today: string;
  delMes: boolean;
  items: AgendaListItem[];
  carga: number;
  onPickDay: (iso: string) => void;
  events: AgendaEvents;
}) {
  const t = useTranslations('panel.agenda');
  const esHoy = iso === today;
  const sobrecargado = items.length > SOBRECARGA;
  const día = Number(iso.slice(8, 10));

  return (
    <div
      className={`group min-h-[92px] border-b border-r border-k-border p-1.5 last:border-r-0 ${
        sobrecargado ? 'bg-k-warning-bg' : delMes ? 'bg-white' : 'bg-k-bg'
      } ${esHoy ? 'ring-1 ring-inset ring-k-periwinkle' : ''}`}
    >
      <div className="flex items-baseline justify-between">
        <button
          type="button"
          onClick={() => onPickDay(iso)}
          className={`rounded px-1 text-[12px] tabular-nums hover:underline ${
            esHoy ? 'font-semibold text-k-periwinkle' : delMes ? 'text-k-text' : 'text-k-muted'
          }`}
        >
          {día}
        </button>
        {carga > 0 && <span className="text-[10px] font-semibold tabular-nums text-k-danger">{t('overdueShort', { n: carga })}</span>}
      </div>

      {/* En pantalla chica sólo el número: tres chips en una celda de 45 px no se leen. */}
      <span className="mt-1 block px-1 text-[11px] tabular-nums text-k-text-2 sm:hidden">
        {items.length > 0 ? items.length : ''}
      </span>

      <ul className="mt-1 hidden space-y-0.5 sm:block">
        {items.slice(0, CHIPS).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => events.onViewRequest(item.id)}
              className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${TIPO_COLOR[item.type] ?? 'bg-k-bg text-k-text-2'}`}
            >
              <span className="tabular-nums">{itemWhen(item, t)}</span> {item.clientName ?? '—'}
            </button>
          </li>
        ))}
        {items.length > CHIPS && (
          <li>
            <button
              type="button"
              onClick={() => onPickDay(iso)}
              className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-k-periwinkle hover:underline"
            >
              {t('more', { n: items.length - CHIPS })}
            </button>
          </li>
        )}
        {/* Día vacío: agendar sin salir del mes. Aparece al pasar por encima. */}
        {items.length === 0 && iso >= today && (
          <li>
            <button
              type="button"
              onClick={() => events.onCreateRequest({ date: iso })}
              className="w-full rounded px-1 py-0.5 text-left text-[11px] text-transparent hover:text-k-periwinkle focus-visible:text-k-periwinkle"
            >
              {t('addShort')}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function Nav({ label, dir, onClick }: { label: string; dir: 'prev' | 'next'; onClick: () => void }) {
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
