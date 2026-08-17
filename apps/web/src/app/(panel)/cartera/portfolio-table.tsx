'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { memberName, type Member } from '@kobrax/shared';
import { EmptyState, Badge } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { money, fullName } from '@/lib/format';
import { rowStatus, STATUS_TONE, type PortfolioRow } from '@/lib/portfolio';

/**
 * La cartera: **una fila por persona**, con lo que debe y hace cuántos días.
 *
 * El orden, la página y los filtros **los resuelve el servidor** (`?sort=&dir=&page=&dpdMin=…`), no
 * esta tabla: la deuda es una suma de los créditos y la mora el máximo, así que ordenar o filtrar
 * acá ordenaría y filtraría sólo la página que se está viendo.
 *
 * 🔴 **La columna Estado no se ordena.** Se deriva en el navegador de la deuda y la mora
 * (`rowStatus`), así que el servidor no la conoce: ofrecerla como ordenable ordenaría por
 * `client_status` —ACTIVO/INACTIVO/BLOQUEADO—, que no es lo que la celda muestra. Sí se puede
 * **filtrar**, porque «en mora» y «pagado» se dicen con los agregados que la consulta ya tiene
 * (`mora ≥ 1` y `deuda = 0`): eso no mete la regla del semáforo adentro del SQL.
 */
export function PortfolioTable({
  rows,
  meta,
  currency,
  hasFilters,
  userId,
  collectors,
  branches,
  action,
}: {
  rows: PortfolioRow[];
  meta: PageMeta;
  currency: string;
  hasFilters: boolean;
  userId?: string;
  collectors: Member[];
  /** «Nuevo cliente». Va en la barra de la tabla, no en el encabezado de la página. */
  action?: ReactNode;
  /** Hoy son cero en toda la base. El filtro se dibuja apagado: el día que haya, funciona sin tocar nada. */
  branches: { id: string; name: string }[];
}) {
  const t = useTranslations('portfolio');

  const columns: Column<PortfolioRow>[] = [
    {
      key: 'name',
      header: t('columns.client'),
      sortable: true,
      render: (c) => (
        <a href={`/cartera/${c.id}`} className="block hover:underline">
          <span className="block font-semibold text-k-text">{fullName(c)}</span>
          {/* Enmascarado: la lista nunca trae la PII en claro. */}
          <span className="block text-[12px] text-k-muted">{c.nationalId ?? '—'}</span>
        </a>
      ),
    },
    {
      key: 'debt',
      header: t('columns.debt'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      // Sin deuda, el número se apaga: la fila que ya pagó no tiene que competir por la atención
      // con las que deben.
      render: (c) => (
        <span className={c.totalDebt > 0 ? 'font-semibold text-k-text' : 'text-k-muted'}>{money(c.totalDebt, currency)}</span>
      ),
    },
    {
      key: 'dpd',
      header: t('columns.arrears'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: (c) =>
        c.maxDaysPastDue > 0 ? (
          // Los días de mora de quien ya pagó son historia, no una alarma: van en gris.
          <span className={c.totalDebt > 0 ? 'font-semibold text-k-danger' : 'text-k-muted'}>
            {t('days', { count: c.maxDaysPastDue })}
          </span>
        ) : (
          <span className="text-k-muted">—</span>
        ),
    },
    {
      key: 'credits',
      header: t('columns.credits'),
      center: true,
      render: (c) => (
        <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md bg-k-bg px-1.5 text-[12px] font-medium text-k-text-2">
          {c.creditCount}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      center: true,
      render: (c) => {
        const status = rowStatus(c);
        // 🔴 El color nunca solo: el punto acompaña al texto, no lo reemplaza.
        return (
          <Badge tone={STATUS_TONE[status]} dot>
            {t(`status.${status}`)}
          </Badge>
        );
      },
    },
    // Existen pero arrancan apagadas: se prenden con el ojito de ⚙ Columnas. Ponerlas por defecto
    // sería tapar lo que se mira todos los días con lo que se mira una vez por mes.
    { key: 'risk', header: t('columns.risk'), visibleByDefault: false, render: (c) => c.riskSegment ?? '—' },
    {
      key: 'clientStatus',
      header: t('columns.clientStatus'),
      visibleByDefault: false,
      render: (c) => t(`clientStatus.${c.status}`),
    },
  ];

  /**
   * Los filtros del panel izquierdo. **Las claves son las de la URL**, y qué significa cada una lo
   * traduce `carteraQuery`: acá no hay una línea de SQL ni de negocio.
   */
  const filters: FilterDef[] = [
    {
      keys: ['collectorId'],
      label: t('filters.collector'),
      type: 'select',
      allLabel: t('filters.allCollectors'),
      options: collectors.map((m) => ({ value: m.userId, label: memberName(m) })),
    },
    {
      keys: ['branchId'],
      label: t('filters.branch'),
      type: 'select',
      allLabel: t('filters.allBranches'),
      options: branches.map((b) => ({ value: b.id, label: b.name })),
    },
    { keys: ['dpdMin', 'dpdMax'], label: t('filters.arrearsRange'), type: 'numberRange' },
    {
      keys: ['estado'],
      label: t('columns.status'),
      type: 'radio',
      // «En mora» y «Pagado» no son estados guardados: son dos preguntas sobre los agregados que la
      // consulta ya calcula. La traducción a `dpdMin`/`debtMax` vive en `carteraQuery`.
      options: [
        { value: 'overdue', label: t('status.OVERDUE') },
        { value: 'paid', label: t('status.PAID') },
      ],
    },
    { keys: ['debtMin', 'debtMax'], label: t('filters.debtRange'), type: 'numberRange' },
  ];

  return (
    <DataTable
      tableId="cartera"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(c) => c.id}
      meta={meta}
      filters={filters}
      filtered={hasFilters}
      entityLabel={t('entity')}
      actions={action}
      search={<SearchBox wide label={t('search.label')} placeholder={t('search.placeholder')} hint={t('search.hint')} />}
      empty={<EmptyState title={t('empty')} text={t('emptyHint')} />}
      // Vacío por filtro y cartera vacía no son lo mismo: uno se arregla borrando el filtro y el
      // otro dando de alta a alguien.
      noResults={<EmptyState title={t('noResults')} text={t('noResultsHint')} />}
    />
  );
}
