'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, type Member, type PaymentItem } from '@kobrax/shared';
import { EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { dateTime, money } from '@/lib/format';

/**
 * El ledger del período.
 *
 * 🔴 **Es el formato de la cartera**: mismo `DataTable`, el período en el panel del costado,
 * columnas configurables y tamaño de página. Antes el período tenía su propia fila de campos encima
 * de la tabla, así que las listas del panel se operaban distinto para hacer lo mismo.
 *
 * ⚠️ **No hay columna de deudor**, y no es un olvido: `GET /payments` devuelve `creditId` y
 * `caseId`, no el nombre. Resolverlo por fila serían dos llamadas por pago —crédito y cliente— o
 * cuarenta por página, para una tabla que se lee de un vistazo. El deudor sale en el detalle, que
 * es una fila sola y se lo puede permitir.
 *
 * Ordenan cuatro de las cinco columnas. **«Registró» no**, y está explicado en `lib/payments.ts`: es
 * un uuid de usuario, así que ordenar por él dejaría los nombres en un orden que no es ninguno.
 *
 * No hay búsqueda: `GET /payments` no acepta `q`.
 */
export function PaymentsTable({
  rows,
  meta,
  members,
  currency,
  filtered,
  userId,
  period,
  action,
}: {
  rows: PaymentItem[];
  meta: PageMeta;
  members: Member[];
  currency: string;
  filtered: boolean;
  userId?: string;
  /** El mes corriente, que es lo que se pide cuando la URL no dice otra cosa. */
  period: { from: string; to: string };
  /** «Registrar pago» / «Pedir un cobro». Va en la barra de la tabla, no en el encabezado. */
  action?: ReactNode;
}) {
  const t = useTranslations('panel.payments');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  const columns: Column<PaymentItem>[] = [
    {
      key: 'date',
      header: t('columns.date'),
      sortable: true,
      // Lo último cobrado primero: es lo que se viene a mirar, y es el orden con el que abre.
      defaultDir: 'desc',
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
      sortable: true,
      // Tocar «Monto» es buscar el pago grande, no los cinco bolivianos de una cuota suelta.
      defaultDir: 'desc',
      render: (p) => <span className="font-medium text-k-text">{money(p.amount, currency)}</span>,
    },
    { key: 'method', header: t('columns.method'), sortable: true, render: (p) => t(`method.${p.method}`) },
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
      sortable: true,
      defaultDir: 'desc',
      render: (p) => (p.receiptNumber != null ? `#${p.receiptNumber}` : '—'),
    },
  ];

  /**
   * El único filtro que la API ofrece para el ledger. `creditId` y `caseId` también se aceptan, pero
   * son uuid que llegan por link desde una ficha: un campo para escribirlos a mano no lo usaría
   * nadie.
   */
  const filters: FilterDef[] = [
    { keys: ['from', 'to'], label: t('filters.period'), type: 'dateRange', defaults: period },
  ];

  return (
    <DataTable
      tableId="pagos"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      meta={meta}
      filters={filters}
      filtered={filtered}
      entityLabel={t('entity')}
      actions={action}
      // Un mes sin cobranza y un filtro que no encontró nada no son lo mismo: uno se arregla
      // cambiando el período, el otro quitándolo.
      empty={<EmptyState title={t('empty')} text={t('emptyText')} />}
      noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
    />
  );
}
