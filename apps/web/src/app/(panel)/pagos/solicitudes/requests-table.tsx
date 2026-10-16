'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PaymentRequestItem } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { dateTime, money } from '@/lib/format';
import { isRequestExpired } from '@/lib/payments';

const STATUS_TONE = { PENDING: 'warning', PAID: 'success', EXPIRED: 'neutral', CANCELLED: 'neutral' } as const;

/**
 * La bandeja de cobros pedidos.
 *
 * Existe porque quien confirma (`payment:approve`) casi nunca es quien pidió el cobro: sin esta lista
 * sólo podía llegar a una solicitud con su link. Abre en lo pendiente.
 *
 * ⚠️ «Vencida» no es un estado: pasadas las 24 h la solicitud sigue `PENDING` y se puede confirmar,
 * porque el deudor puede pagar tarde. La fila lo avisa, no lo bloquea.
 */
export function RequestsTable({
  rows,
  meta,
  currency,
  status,
  userId,
  action,
}: {
  rows: PaymentRequestItem[];
  meta: PageMeta;
  currency: string;
  status: string;
  userId?: string;
  action?: ReactNode;
}) {
  const t = useTranslations('panel.payments');
  const locale = useLocale();

  const columns: Column<PaymentRequestItem>[] = [
    {
      key: 'createdAt',
      header: t('requests.columns.createdAt'),
      render: (r) => (
        <a href={`/pagos/solicitudes/${r.id}`} className="hover:underline">
          {r.createdAt ? dateTime(r.createdAt, locale) : '—'}
        </a>
      ),
    },
    {
      key: 'debtor',
      header: t('requests.columns.debtor'),
      render: (r) => (
        <span>
          {r.clientName ?? <span className="text-k-muted">—</span>}
          {r.creditCode && <span className="ml-2 text-k-text-2">{r.creditCode}</span>}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('requests.columns.amount'),
      numeric: true,
      render: (r) => <span className="font-medium text-k-text">{money(r.amount, currency)}</span>,
    },
    { key: 'method', header: t('requests.columns.method'), render: (r) => t(`method.${r.method}`) },
    {
      key: 'createdBy',
      header: t('requests.columns.createdBy'),
      render: (r) => r.createdByName ?? <span className="text-k-muted">{t('unknownUser')}</span>,
    },
    {
      key: 'status',
      header: t('requests.columns.status'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
          {isRequestExpired(r) && <Badge tone="neutral">{t('requests.expired')}</Badge>}
        </span>
      ),
    },
  ];

  const filters: FilterDef[] = [
    {
      keys: ['status'],
      label: t('requests.filters.status'),
      type: 'select',
      // «Sin filtro» ES lo pendiente: es lo que la bandeja muestra cuando la URL no dice nada. Los
      // demás estados, y «todas», son opciones explícitas.
      allLabel: t('status.PENDING'),
      options: [
        { value: 'ALL', label: t('requests.filters.all') },
        ...(['PAID', 'EXPIRED', 'CANCELLED'] as const).map((s) => ({ value: s, label: t(`status.${s}`) })),
      ],
    },
  ];

  return (
    <DataTable
      tableId="pagos-solicitudes"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      meta={meta}
      filters={filters}
      filtered={status !== 'PENDING'}
      entityLabel={t('requests.entity')}
      actions={action}
      empty={<EmptyState title={t('requests.empty')} text={t('requests.emptyText')} />}
      noResults={<EmptyState title={t('requests.noResults')} text={t('requests.noResultsText')} />}
    />
  );
}
