'use client';

import { useLocale, useTranslations } from 'next-intl';
import { memberName, RouteStatus, type Member, type RouteItem } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { dayDate } from '@/lib/format';
import { ROUTE_STATUS_TONE } from '@/lib/routes';

/**
 * Las rutas del día.
 *
 * 🔴 **Es el formato de la cartera, no una tabla aparte**: mismo `DataTable`, filtros en el panel
 * del costado, columnas configurables y tamaño de página. Antes tenía su propia fila de
 * desplegables encima de la tabla, así que las listas del panel se operaban distinto para hacer lo
 * mismo.
 *
 * **Ninguna columna ordena**: `GET /routes` ordena por fecha planificada y no acepta `?sort=`.
 * Dibujar la flecha igual prometería un orden que el servidor no va a aplicar.
 *
 * **Y no hay búsqueda**: el listado tampoco acepta `?q=`. Una caja que no busca es peor que ninguna.
 */
export function RoutesTable({
  rows,
  meta,
  members,
  filtered,
  userId,
  showCollector,
}: {
  rows: RouteItem[];
  meta: PageMeta;
  members: Member[];
  filtered: boolean;
  userId?: string;
  /** Sin `route:assign` la API ya acota a lo propio: el filtro por cobrador no cambiaría nada. */
  showCollector: boolean;
}) {
  const t = useTranslations('panel.routes');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  const columns: Column<RouteItem>[] = [
    {
      /*
       * El día de la ruta. Con el selector de arriba puesto son todas el mismo, pero la fecha
       * escrita en la fila es lo que hace que la vista siga diciendo de qué día es cuando se
       * imprime, se comparte por link o se mira una captura.
       */
      key: 'plannedDate',
      header: t('columns.date'),
      render: (r) => <span className="whitespace-nowrap text-k-text-2">{dayDate(r.plannedDate, locale)}</span>,
    },
    {
      key: 'collector',
      header: t('columns.collector'),
      render: (r) => (
        <a href={`/rutas/${r.id}`} className="block font-medium text-k-text hover:underline">
          {/* Sin nombre no es sin cobrador: `/users` da 403 sin `user:read`, que es el caso de una
              supervisora. Toda ruta tiene dueño. */}
          {byId.get(r.collectorId) ?? t('unknownCollector')}
        </a>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (r) => <Badge tone={ROUTE_STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>,
    },
    {
      key: 'stops',
      header: t('columns.stops'),
      numeric: true,
      // `totalCases` es la cuenta de paradas. El avance NO se puede mostrar acá: el listado no
      // trae las paradas, y «0 de 0» sería una mentira, no un cero.
      render: (r) => r.totalCases,
    },
    {
      key: 'distance',
      header: t('columns.distance'),
      numeric: true,
      render: (r) => (r.totalDistanceKm != null ? t('km', { n: r.totalDistanceKm.toFixed(1) }) : '—'),
    },
    {
      key: 'duration',
      header: t('columns.duration'),
      numeric: true,
      render: (r) => (r.estimatedMinutes != null ? t('minutes', { n: r.estimatedMinutes }) : '—'),
    },
  ];

  /** Los filtros del panel. **Las claves son las de la URL**; qué significa cada una, `routeQuery`. */
  const filters: FilterDef[] = [
    ...(showCollector
      ? [
          {
            keys: ['collectorId'],
            label: t('filters.collector'),
            type: 'select' as const,
            allLabel: t('filters.all'),
            options: members.map((m) => ({ value: m.userId, label: memberName(m) })),
          },
        ]
      : []),
    {
      keys: ['status'],
      label: t('filters.status'),
      type: 'select',
      allLabel: t('filters.all'),
      options: Object.values(RouteStatus).map((s) => ({ value: s, label: t(`status.${s}`) })),
    },
  ];

  return (
    <DataTable
      tableId="rutas"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      meta={meta}
      filters={filters}
      filtered={filtered}
      entityLabel={t('entity')}
      // Sin rutas ese día y sin resultados con esos filtros no son lo mismo: uno se arregla
      // cambiando de día, el otro quitando un filtro.
      empty={<EmptyState title={t('empty')} text={t('emptyText')} />}
      noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
    />
  );
}
