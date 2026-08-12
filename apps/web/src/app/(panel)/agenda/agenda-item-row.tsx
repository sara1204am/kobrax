import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AgendaItemStatus, type AgendaListItem } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { AGENDA_STATUS_TONE, itemWhen } from '@/lib/agenda';

/**
 * Una gestión en la lista del día. Server component: la fila no tiene interacción propia —lo que
 * se hace con la gestión vive en su detalle— así que no viaja como JavaScript.
 */
export async function AgendaItemRow({ item }: { item: AgendaListItem }) {
  const t = await getTranslations('panel.agenda');

  const when = itemWhen(item, t);

  return (
    <li>
      <Link
        href={`/agenda/${item.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-k-border bg-white px-5 py-3.5 hover:bg-k-bg"
      >
        <span className="w-[72px] shrink-0 text-[14px] font-semibold tabular-nums text-k-navy">{when}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-k-text">{item.clientName ?? '—'}</span>
          <span className="block text-[13px] text-k-text-2">{t(`type.${item.type}`)}</span>
        </span>
        {/* Vencida sólo si sigue pendiente: una ejecutada tarde ya no le debe nada a nadie. */}
        {item.isOverdue && item.status === AgendaItemStatus.SCHEDULED && (
          <Badge tone="danger">{t('overdueBadge')}</Badge>
        )}
        {item.status !== AgendaItemStatus.SCHEDULED && (
          <Badge tone={AGENDA_STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Badge>
        )}
      </Link>
    </li>
  );
}
