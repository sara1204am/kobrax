'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ImportRunItem, ImportRunItemAction } from '@kobrax/shared';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import { Badge, EmptyState } from '@/components/panel-ui';
import { money } from '@/lib/format';
import { rejectText } from '@/lib/import';
import { ValueChange } from '../value-change';

const ACTION_TONE: Record<ImportRunItemAction, 'neutral' | 'success' | 'warning' | 'danger'> = {
  CREATED: 'success',
  UPDATED: 'neutral',
  REAPPEARED: 'neutral',
  SET_CURRENT: 'warning',
  ABSENT: 'warning',
  REJECTED: 'danger',
};

/**
 * Los movimientos de una importación: quién es cada registro y cómo quedó.
 *
 * Saldo y mora se muestran **antes → después** cuando cambian: es la pregunta que se viene a hacer
 * («¿a quién le subió la mora?»). La que no vino en el reporte (ausente) sólo tiene el antes; la
 * nueva, sólo el después.
 */
export function RunItemsTable({
  rows,
  meta,
  currency,
  showAction,
  userId,
}: {
  rows: ImportRunItem[];
  meta: PageMeta;
  currency: string;
  /** En «Todos» cada fila dice qué le pasó; con una pestaña elegida sobra. */
  showAction: boolean;
  userId?: string;
}) {
  const t = useTranslations('panel.import');
  const tp = useTranslations('portfolio');

  const columns: Column<ImportRunItem>[] = [
    {
      key: 'row',
      header: t('detail.columns.row'),
      numeric: true,
      sortable: false,
      render: (r) => (r.rowNumber != null ? r.rowNumber : <span className="text-k-muted">—</span>),
    },
    { key: 'code', header: t('detail.columns.code'), sortable: false, render: (r) => r.externalId ?? '—' },
    {
      key: 'client',
      header: t('detail.columns.client'),
      sortable: false,
      render: (r) => (
        <>
          {r.clientId ? (
            <Link href={`/cartera/${r.clientId}`} className="font-medium text-k-text hover:underline">
              {r.clientName ?? '—'}
            </Link>
          ) : (
            <span className="text-k-text">{r.clientName ?? '—'}</span>
          )}
          {/* D2: si la nueva abrió cliente o se sumó a uno que ya existía, y si quedó a revisar. */}
          {r.action === 'CREATED' && (
            <span className="block text-[12px] text-k-text-2">
              {r.after?.newClient ? t('detail.newClient') : t('detail.existingClient')}
              {r.after?.linkReview && <span className="ml-2 font-semibold text-k-warning-text">{t('detail.linkReview')}</span>}
            </span>
          )}
        </>
      ),
    },
    ...(showAction
      ? [
          {
            key: 'movement',
            header: t('detail.columns.movement'),
            sortable: false,
            render: (r: ImportRunItem) => <Badge tone={ACTION_TONE[r.action]}>{t(`detail.tabs.${r.action}`)}</Badge>,
          },
        ]
      : []),
    {
      key: 'balance',
      header: t('detail.columns.balance'),
      numeric: true,
      sortable: false,
      render: (r) => <ValueChange before={r.before?.outstandingBalance} after={r.after?.outstandingBalance} format={(v) => money(v, currency)} />,
    },
    {
      key: 'arrears',
      header: t('detail.columns.arrears'),
      numeric: true,
      sortable: false,
      render: (r) => <ValueChange before={r.before?.daysPastDue} after={r.after?.daysPastDue} format={(v) => t('detail.days', { n: v })} />,
    },
    {
      key: 'status',
      header: t('detail.columns.status'),
      sortable: false,
      render: (r) => {
        // El estado tal como lo escribió el banco («Vencida») dice más que el nuestro; si no vino, el del crédito.
        const reported = r.after?.reportedStatus;
        const status = r.after?.status ?? r.before?.status;
        if (reported) return <span className="text-[13px] text-k-text-2">{reported}</span>;
        return status ? <span className="text-[13px] text-k-text-2">{tp(`creditStatus.${status}`)}</span> : '—';
      },
    },
    {
      key: 'note',
      header: t('detail.columns.note'),
      sortable: false,
      render: (r) => (r.reason ? <span className="text-[13px] text-k-danger">{rejectText(r.reason, t)}</span> : null),
    },
  ];

  return (
    <DataTable
      tableId="import-movimientos"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      meta={meta}
      entityLabel={t('detail.entity')}
      empty={<EmptyState title={t('detail.empty')} />}
    />
  );
}
