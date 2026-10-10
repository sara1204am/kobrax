'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { RouteStatus } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { money } from '@/lib/format';
import { NO_ROUTE, ROUTE_STATUS_TONE, routePercent, type TodayRow } from '@/lib/routes';
import { StartRouteButton } from './start-route-button';

/**
 * La tabla de «Hoy»: una fila por cobrador.
 *
 * 🔴 **Es el `DataTable` del resto del panel** (filtros en el costado, orden por columna, columnas
 * configurables), no una tabla a mano. Orden y filtros viven en la URL como en cartera, pero **los
 * resuelve el servidor en memoria** (`filterTodayRows`): el día entero llega de una vez, así que el
 * orden es exacto y no hay páginas que ordenar a medias.
 *
 * Recibe las filas **ya filtradas y ordenadas**; acá sólo se dibujan.
 */
export function TodayTable({
  rows,
  names,
  day,
  userId,
  canPlan,
  filtered,
  collectorOptions,
}: {
  rows: TodayRow[];
  /** `collectorId → nombre`. Sin nombre no es sin cobrador: `/users` da 403 sin `user:read`. */
  names: Record<string, string>;
  day: string;
  userId?: string;
  canPlan: boolean;
  filtered: boolean;
  /** Los cobradores del día, para el filtro. Vacío = no hay filtro por cobrador (quien ve solo lo suyo). */
  collectorOptions: { value: string; label: string }[];
}) {
  const t = useTranslations('panel.routes');
  const nameOf = (id: string) => names[id] ?? t('unknownCollector');

  const columns: Column<TodayRow>[] = [
    {
      key: 'collector',
      header: t('todayBoard.cols.collector'),
      sortable: true,
      defaultDir: 'asc',
      render: (r) => <span className="font-medium text-k-text">{nameOf(r.collectorId)}</span>,
    },
    {
      key: 'status',
      header: t('todayBoard.cols.status'),
      sortable: true,
      defaultDir: 'asc',
      render: ({ route }) =>
        route ? (
          <Badge tone={ROUTE_STATUS_TONE[route.status]} dot>
            {t(`status.${route.status}`)}
          </Badge>
        ) : (
          <Badge tone="neutral">{t('todayBoard.noRoute')}</Badge>
        ),
    },
    {
      key: 'stops',
      header: t('todayBoard.cols.stops'),
      sortable: true,
      // Quien más paradas tiene, primero: es lo que se mira para repartir la carga.
      defaultDir: 'desc',
      render: ({ route }) => (
        <span className="tabular-nums text-k-text-2">
          {route ? t('progress', { done: route.visitedCount ?? 0, total: route.totalCases }) : '—'}
        </span>
      ),
    },
    {
      key: 'progress',
      header: t('todayBoard.cols.progress'),
      sortable: true,
      defaultDir: 'desc',
      render: ({ route }) => {
        if (!route) return '—';
        const percent = routePercent(route);
        return (
          <span className="flex items-center gap-2">
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={t('detail.percent')}
              className="h-2 w-24 overflow-hidden rounded-full bg-k-light-bg"
            >
              <span
                className={`block h-full rounded-full ${percent === 100 ? 'bg-k-success' : 'bg-gradient-to-r from-k-periwinkle to-k-purple'}`}
                style={{ width: `${percent}%` }}
              />
            </span>
            {/* El número va igual: el color no es el dato. */}
            <span className="text-[12px] tabular-nums text-k-text-2">{percent}%</span>
          </span>
        );
      },
    },
    {
      key: 'collected',
      header: t('todayBoard.cols.collected'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: ({ route }) => (
        <span className="tabular-nums text-k-text">{route && route.collected != null ? money(route.collected, 'BOB') : '—'}</span>
      ),
    },
    {
      key: 'next',
      header: t('todayBoard.cols.next'),
      render: ({ route }) => (
        <span className="text-k-text-2">
          {route?.nextStop ? (
            <span className="block max-w-[220px] truncate">
              <span className="tabular-nums text-k-navy">#{route.nextStop.sequenceOrder}</span> · {route.nextStop.clientName ?? '—'}
            </span>
          ) : route && route.status !== RouteStatus.CANCELLED && (route.visitedCount ?? 0) >= route.totalCases && route.totalCases > 0 ? (
            t('todayBoard.allDone')
          ) : (
            '—'
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('todayBoard.cols.actions'),
      numeric: true,
      render: ({ collectorId, route }) => {
        const mine = !!userId && (route?.collectorId === userId || route?.createdBy === userId);
        if (route) {
          return route.status === RouteStatus.PLANNED && mine ? (
            <StartRouteButton routeId={route.id} />
          ) : (
            <Link
              href={`/rutas/${route.id}`}
              className="inline-flex h-8 items-center rounded-lg border border-k-border bg-white px-3.5 text-[13px] font-medium text-k-slate hover:bg-k-bg"
            >
              {t('todayBoard.view')}
            </Link>
          );
        }
        return canPlan ? (
          <Link
            href={`/rutas/planificar?date=${day}&collectorId=${collectorId}`}
            className="inline-flex h-8 items-center rounded-lg border border-k-periwinkle bg-k-highlight px-3.5 text-[13px] font-medium text-k-periwinkle hover:bg-k-light-bg"
          >
            {t('todayBoard.plan')}
          </Link>
        ) : null;
      },
    },
  ];

  /** Las claves son las de la URL; qué significa cada una, `filterTodayRows`. */
  const filters: FilterDef[] = [
    ...(collectorOptions.length > 0
      ? [
          {
            keys: ['collectorId'],
            label: t('filters.collector'),
            type: 'select' as const,
            allLabel: t('filters.all'),
            options: collectorOptions,
          },
        ]
      : []),
    {
      keys: ['status'],
      label: t('filters.status'),
      type: 'select',
      allLabel: t('filters.all'),
      options: [
        ...Object.values(RouteStatus).map((s) => ({ value: s, label: t(`status.${s}`) })),
        // Lo que la API no tiene: la pregunta del día es tanto «¿cómo va cada una?» como «¿a quién le falta?».
        { value: NO_ROUTE, label: t('todayBoard.noRoute') },
      ],
    },
  ];

  return (
    <DataTable
      tableId="rutas-hoy"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.collectorId}
      // Una página: son tantas filas como cobradores y llegan todas.
      meta={{ total: rows.length, page: 1, limit: Math.max(1, rows.length), pages: 1 }}
      filters={filters}
      filtered={filtered}
      entityLabel={t('todayBoard.entity')}
      empty={<EmptyState title={t('todayBoard.empty')} />}
      noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
    />
  );
}
