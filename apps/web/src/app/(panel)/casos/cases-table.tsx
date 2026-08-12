'use client';

import { useTranslations } from 'next-intl';
import { memberName, type CaseListItem, type Member } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import { PRIORITY_TONE, STATUS_TONE } from '@/lib/cases';
import { date, money } from '@/lib/format';

/**
 * La lista de casos.
 *
 * El orden lo resuelve el servidor desde W5-T0: las columnas ordenables son exactamente las cinco
 * que `GET /cases` sabe ordenar. Mora y saldo salen del crédito, no del caso, y por eso hubo que
 * tocar la API para poder ordenarlas — ordenarlas acá habría ordenado sólo la página visible.
 */
export function CasesTable({
  rows,
  meta,
  members,
  currency,
  filtered,
}: {
  rows: CaseListItem[];
  meta: PageMeta;
  members: Member[];
  currency: string;
  filtered: boolean;
}) {
  const t = useTranslations('panel.cases');
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  const columns: Column<CaseListItem>[] = [
    {
      key: 'client',
      header: t('columns.client'),
      render: (c) => (
        <a href={`/casos/${c.id}`} className="block hover:underline">
          <span className="block font-medium text-k-text">{c.clientName ?? '—'}</span>
          {c.isOverdue && (
            <span className="block text-[12px] font-medium text-k-danger">{t('overdueBadge')}</span>
          )}
        </a>
      ),
    },
    {
      key: 'daysPastDue',
      header: t('columns.daysPastDue'),
      sortable: true,
      numeric: true,
      render: (c) =>
        c.daysPastDue && c.daysPastDue > 0 ? (
          <span className="font-medium text-k-danger">{t('days', { n: c.daysPastDue })}</span>
        ) : (
          <span className="text-k-muted">—</span>
        ),
    },
    {
      key: 'balance',
      header: t('columns.balance'),
      sortable: true,
      numeric: true,
      render: (c) => money(c.amount, c.currency ?? currency),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (c) => <Badge tone={STATUS_TONE[c.status]}>{t(`status.${c.status}`)}</Badge>,
    },
    {
      key: 'priority',
      header: t('columns.priority'),
      sortable: true,
      render: (c) => <Badge tone={PRIORITY_TONE[c.priority]}>{t(`priority.${c.priority}`)}</Badge>,
    },
    {
      key: 'assignee',
      header: t('columns.assignee'),
      render: (c) => byId.get(c.assigneeId ?? '') ?? <span className="text-k-muted">{t('noAssignee')}</span>,
    },
    {
      key: 'slaDueAt',
      header: t('columns.slaDueAt'),
      sortable: true,
      render: (c) => <span className={c.isOverdue ? 'text-k-danger' : ''}>{date(c.slaDueAt)}</span>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(c) => c.id}
      meta={meta}
      empty={
        // Vacío por filtro y sin casos no son lo mismo: uno se arregla borrando el filtro y el
        // otro generándolos.
        <EmptyState
          title={filtered ? t('noResults') : t('empty')}
          text={filtered ? t('noResultsText') : t('emptyText')}
        />
      }
    />
  );
}
