'use client';

import { useLocale, useTranslations } from 'next-intl';
import { memberName, type Member, type PaymentItem } from '@kobrax/shared';
import { EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import { dateTime, money } from '@/lib/format';

/**
 * El ledger del período.
 *
 * ⚠️ **No hay columna de deudor**, y no es un olvido: `GET /payments` devuelve `creditId` y
 * `caseId`, no el nombre. Resolverlo por fila serían dos llamadas por pago —crédito y cliente— o
 * cuarenta por página, para una tabla que se lee de un vistazo. El deudor sale en el detalle, que
 * es una fila sola y se lo puede permitir.
 *
 * Ninguna columna ordena: `GET /payments` no acepta `sort`.
 */
export function PaymentsTable({
  rows,
  meta,
  members,
  currency,
}: {
  rows: PaymentItem[];
  meta: PageMeta;
  members: Member[];
  currency: string;
}) {
  const t = useTranslations('panel.payments');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  const columns: Column<PaymentItem>[] = [
    {
      key: 'date',
      header: t('columns.date'),
      render: (p) => (
        <a href={`/pagos/${p.id}`} className="hover:underline">
          {dateTime(p.paymentDate, locale)}
        </a>
      ),
    },
    {
      key: 'amount',
      header: t('columns.amount'),
      numeric: true,
      render: (p) => <span className="font-medium text-k-text">{money(p.amount, currency)}</span>,
    },
    { key: 'method', header: t('columns.method'), render: (p) => t(`method.${p.method}`) },
    {
      key: 'registeredBy',
      header: t('columns.registeredBy'),
      // Sin nombre no es «nadie»: `/users` da 403 sin `user:read`, y todo pago tiene quien lo cargó.
      render: (p) => byId.get(p.registeredBy ?? '') ?? <span className="text-k-muted">{t('unknownUser')}</span>,
    },
    {
      key: 'receipt',
      header: t('columns.receipt'),
      numeric: true,
      render: (p) => (p.receiptNumber != null ? `#${p.receiptNumber}` : '—'),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      meta={meta}
      empty={<EmptyState title={t('empty')} text={t('emptyText')} />}
    />
  );
}
