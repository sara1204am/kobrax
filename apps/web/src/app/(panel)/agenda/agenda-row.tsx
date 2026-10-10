'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AgendaItemStatus, type AgendaListItem } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { SituationBadge } from '@/components/situation-badge';
import { AGENDA_STATUS_TONE, itemActions, rowTime } from '@/lib/agenda';
import { money } from '@/lib/format';
import type { AgendaEvents } from './agenda-screen';

/** La barra de la izquierda dice en qué está la gestión: pendiente, vencida, hecha o distinta. */
function accent(item: AgendaListItem): string {
  if (item.status === AgendaItemStatus.EXECUTED) return 'bg-k-success';
  if (item.status !== AgendaItemStatus.SCHEDULED) return 'bg-k-muted';
  return item.isOverdue ? 'bg-k-danger' : 'bg-k-periwinkle';
}

/**
 * Una gestión del día: hora, qué es y a quién, situación del crédito, saldo, cobrador y el menú «⋮».
 *
 * 🔴 **No hay reglas de negocio acá.** Completar, reagendar y cancelar se **piden** (`events`) y las
 * resuelve el detalle de la gestión, que ya las tiene. Qué acciones se ofrecen lo decide `itemActions`.
 * Lo que la API no trae (situación, saldo, cobrador) simplemente no se dibuja: nada se inventa.
 */
export function AgendaRow({
  item,
  events,
  timeLabel,
}: {
  item: AgendaListItem;
  events: AgendaEvents;
  /** Pisa la hora de la izquierda: las vencidas muestran su día, no una hora suelta. */
  timeLabel?: string;
}) {
  const t = useTranslations('panel.agenda');
  const hecha = item.status !== AgendaItemStatus.SCHEDULED;
  const nombre = item.clientName ?? '—';
  const sub = item.creditCode ? `${nombre} · ${t('credit', { code: item.creditCode })}` : nombre;

  return (
    <li
      data-testid="agenda-row"
      className={`relative flex items-stretch border-b border-k-border bg-white last:border-b-0 hover:bg-k-bg ${hecha ? 'opacity-70' : ''}`}
    >
      <span aria-hidden className={`my-2 ml-1 w-1 shrink-0 rounded-full ${accent(item)}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-3 pl-3 pr-1 md:grid md:grid-cols-[72px_minmax(0,1.6fr)_minmax(130px,1fr)_100px_minmax(90px,1fr)] md:items-center md:gap-4">
        <span className="text-[13px] font-medium tabular-nums text-k-navy md:border-r md:border-k-border md:pr-3">
          {timeLabel ?? rowTime(item) ?? '—'}
        </span>

        <button type="button" onClick={() => events.onViewRequest(item.id)} className="min-w-0 text-left">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-k-text">{t(`type.${item.type}`)}</span>
            {item.isOverdue && !hecha && <Badge tone="danger">{t('overdueBadge')}</Badge>}
            {hecha && <Badge tone={AGENDA_STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Badge>}
          </span>
          <span className="block truncate text-[12px] text-k-text-2">{sub}</span>
        </button>

        <span className="min-w-0">
          {item.creditSituation && (
            <SituationBadge
              situation={item.creditSituation}
              daysPastDue={item.daysPastDue ?? 0}
              category={item.category}
            />
          )}
        </span>

        <span className="text-[13px] tabular-nums text-k-text md:text-right">
          {item.balance != null ? money(item.balance, item.currency) : ''}
        </span>

        <span className="truncate text-[13px] text-k-text-2">{item.assigneeName ?? ''}</span>
      </div>
      <RowMenu item={item} events={events} />
    </li>
  );
}

/** El «⋮»: ver el detalle siempre; completar, reagendar y cancelar sólo si la gestión sigue pendiente. */
function RowMenu({ item, events }: { item: AgendaListItem; events: AgendaEvents }) {
  const t = useTranslations('panel.agenda');
  const [open, setOpen] = useState(false);
  /** Abre hacia arriba cuando abajo no cabe: en la última fila del día el menú se salía de la pantalla y creaba scroll. */
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const allowed = itemActions(item.status);

  /* Cierra al tocar afuera y con Esc: un menú que sólo cierra con su propio botón tapa la fila de abajo. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const entries: { key: string; label: string; run: () => void }[] = [
    { key: 'open', label: t('actions.open'), run: () => events.onViewRequest(item.id) },
    ...(allowed.includes('complete')
      ? [{ key: 'complete', label: t('actions.complete'), run: () => events.onCompleteRequest(item.id) }]
      : []),
    ...(allowed.includes('reschedule')
      ? [{ key: 'reschedule', label: t('actions.reschedule'), run: () => events.onRescheduleRequest(item.id) }]
      : []),
    ...(allowed.includes('cancel')
      ? [{ key: 'cancel', label: t('actions.cancel'), run: () => events.onCancelRequest(item.id) }]
      : []),
    // Editar y eliminar: solo quien la creó (la API manda `canEdit`; la misma API las rechaza con 403 a los demás).
    ...(item.canEdit
      ? [
          { key: 'edit', label: t('actions.edit'), run: () => events.onEditRequest(item.id) },
          { key: 'delete', label: t('actions.delete'), run: () => events.onDeleteRequest(item.id) },
        ]
      : []),
  ];

  return (
    <div ref={box} className="relative flex shrink-0 items-start pr-2 pt-2.5">
      <button
        type="button"
        aria-label={t('menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            const r = box.current?.getBoundingClientRect();
            // Alto del menú: ~36 px por opción + el relleno. Si abajo no entra y arriba sí, se voltea.
            const need = entries.length * 36 + 16;
            setUp(!!r && window.innerHeight - r.bottom < need && r.top > need);
          }
          setOpen((v) => !v);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-k-text-2 hover:bg-k-light-bg"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-2 z-20 w-52 rounded-xl border border-k-border bg-white py-1 shadow-k-card ${up ? 'bottom-10' : 'top-10'}`}
        >
          {entries.map((e) => (
            <button
              key={e.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                e.run();
              }}
              className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-k-bg ${e.key === 'cancel' || e.key === 'delete' ? 'text-k-danger' : 'text-k-text'}`}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
