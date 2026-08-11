'use client';

import { useTranslations } from 'next-intl';
import { EmptyState, Badge } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import { money, fullName } from '@/lib/format';
import { rowStatus, STATUS_TONE, type PortfolioRow } from '@/lib/portfolio';

/**
 * La cartera: una fila por cliente, con lo que debe y hace cuántos días.
 *
 * El orden y la página **los resuelve el servidor** (`?sort=&dir=&page=`), no esta tabla: la deuda
 * es una suma de los créditos y la mora el máximo, así que ordenar acá ordenaría sólo la página
 * que se está viendo. Por eso tampoco hay columnas ordenables que el servidor no sepa ordenar.
 */
export function PortfolioTable({
  rows,
  meta,
  currency,
  hasFilters,
}: {
  rows: PortfolioRow[];
  meta: PageMeta;
  currency: string;
  hasFilters: boolean;
}) {
  const t = useTranslations('portfolio');

  const columns: Column<PortfolioRow>[] = [
    {
      key: 'name',
      header: t('columns.client'),
      sortable: true,
      render: (c) => (
        <a href={`/cartera/${c.id}`} className="block hover:underline">
          <span className="block font-medium text-k-text">{fullName(c)}</span>
          {/* Enmascarado: la lista nunca trae la PII en claro. */}
          <span className="block text-[13px] text-k-text-2">{c.nationalId ?? '—'}</span>
        </a>
      ),
    },
    {
      key: 'debt',
      header: t('columns.debt'),
      sortable: true,
      numeric: true,
      render: (c) => money(c.totalDebt, currency),
    },
    {
      key: 'dpd',
      header: t('columns.arrears'),
      sortable: true,
      numeric: true,
      render: (c) =>
        c.maxDaysPastDue > 0 ? (
          <span className="font-medium text-k-danger">{t('days', { count: c.maxDaysPastDue })}</span>
        ) : (
          <span className="text-k-muted">—</span>
        ),
    },
    {
      key: 'credits',
      header: t('columns.credits'),
      numeric: true,
      render: (c) => c.creditCount,
    },
    {
      key: 'status',
      header: t('columns.status'),
      sortable: true,
      render: (c) => {
        const status = rowStatus(c);
        return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(c) => c.id}
      meta={meta}
      empty={
        // Vacío por filtro y cartera vacía no son lo mismo: uno se arregla borrando el filtro y
        // el otro dando de alta a alguien.
        <EmptyState
          title={hasFilters ? t('noResults') : t('empty')}
          text={hasFilters ? t('noResultsHint') : t('emptyHint')}
        />
      }
    />
  );
}
