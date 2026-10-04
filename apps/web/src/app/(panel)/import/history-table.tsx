'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ImportRunCounts, ImportRunItemAction, ImportRunSummary, ScopeMember } from '@kobrax/shared';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { EmptyState } from '@/components/panel-ui';
import { SearchBox } from '@/components/search-box';
import { dateTime, dayDate } from '@/lib/format';

/** Cada número del historial abre el detalle ya filtrado por esos registros. */
const ACTION_OF: Partial<Record<keyof ImportRunCounts, ImportRunItemAction>> = {
  created: 'CREATED',
  updated: 'UPDATED',
  reappeared: 'REAPPEARED',
  setCurrent: 'SET_CURRENT',
  absent: 'ABSENT',
  rejected: 'REJECTED',
};

/**
 * El historial de importaciones: una fila por archivo importado, con lo que cambió.
 *
 * Mismo `DataTable` que el resto del panel —página y tamaño en la URL—, sin orden por columna: el
 * historial se lee de la más reciente para atrás, que es el único orden que la API ofrece.
 *
 * Búsqueda y filtros como la cartera, y por la misma razón: **los resuelve la API**. Filtrar en el
 * navegador filtraría sólo la página que se está viendo.
 *
 * 🔴 **Un número es un link, y el cero no.** Tocar «4 ausentes» lleva al detalle mostrando esas
 * cuatro; un cero lleva a una lista vacía, así que se dibuja apagado y sin link.
 */
export function ImportHistoryTable({
  rows,
  meta,
  userId,
  hasFilters,
  importers,
}: {
  rows: ImportRunSummary[];
  meta: PageMeta;
  userId?: string;
  hasFilters: boolean;
  /**
   * El equipo, para el filtro «Importó». Sale de la configuración del import (`client:import`) y no de
   * `/users`: el supervisor importa pero no administra usuarios, y con `/users` el filtro le quedaba vacío.
   */
  importers: ScopeMember[];
}) {
  const t = useTranslations('panel.import.history');
  const locale = useLocale();

  const count = (key: keyof ImportRunCounts, danger = false): Column<ImportRunSummary> => ({
    key,
    header: t(`columns.${key}`),
    numeric: true,
    sortable: false,
    render: (r) => {
      const n = r.counts[key];
      if (n === 0) return <span className="text-k-muted">0</span>;
      const action = ACTION_OF[key];
      return (
        <Link
          href={`/import/${r.id}${action ? `?action=${action}` : ''}`}
          className={`font-medium tabular-nums hover:underline ${danger ? 'text-k-danger' : 'text-k-purple'}`}
        >
          {n}
        </Link>
      );
    },
  });

  const columns: Column<ImportRunSummary>[] = [
    {
      key: 'date',
      header: t('columns.date'),
      sortable: false,
      render: (r) => (
        <Link href={`/import/${r.id}`} className="font-semibold text-k-text hover:underline">
          {dateTime(r.at, locale)}
        </Link>
      ),
    },
    {
      key: 'file',
      header: t('columns.file'),
      sortable: false,
      render: (r) =>
        r.file ? (
          <span className="block max-w-[220px] truncate text-[13px] text-k-text-2" title={r.file.name}>
            {r.file.name}
          </span>
        ) : (
          <span className="text-[13px] text-k-muted">{t('noFile')}</span>
        ),
    },
    { key: 'reportDate', header: t('columns.reportDate'), sortable: false, render: (r) => (r.reportDate ? dayDate(r.reportDate, locale) : '—') },
    { key: 'advisor', header: t('columns.advisor'), sortable: false, render: (r) => r.advisorCode ?? '—' },
    { key: 'by', header: t('columns.by'), sortable: false, render: (r) => r.createdBy?.name ?? '—' },
    count('created'),
    count('updated'),
    count('reappeared'),
    count('setCurrent'),
    count('absent'),
    count('rejected', true),
  ];

  const filters: FilterDef[] = [
    { keys: ['from', 'to'], label: t('filters.importedAt'), type: 'dateRange' },
    { keys: ['reportFrom', 'reportTo'], label: t('filters.reportDate'), type: 'dateRange' },
    {
      keys: ['createdBy'],
      label: t('filters.by'),
      type: 'select',
      allLabel: t('filters.allImporters'),
      options: importers.map((m) => ({ value: m.id, label: m.name })),
    },
  ];

  return (
    <DataTable
      tableId="import-historial"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      meta={meta}
      filters={filters}
      filtered={hasFilters}
      entityLabel={t('entity')}
      search={<SearchBox wide label={t('search.label')} placeholder={t('search.placeholder')} hint={t('search.hint')} />}
      empty={<EmptyState title={t('empty')} />}
      // Sin importaciones todavía y sin resultados para un filtro no son lo mismo: uno se arregla
      // importando y el otro borrando el filtro.
      noResults={<EmptyState title={t('noResults')} text={t('noResultsHint')} />}
    />
  );
}
