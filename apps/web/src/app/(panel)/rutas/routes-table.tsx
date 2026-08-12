'use client';

import { useTranslations } from 'next-intl';
import { memberName, type Member, type RouteItem } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import { ROUTE_STATUS_TONE } from '@/lib/routes';

/**
 * Las rutas del día.
 *
 * **Ninguna columna ordena**: `GET /routes` ordena por fecha planificada y no acepta `?sort=`.
 * Dibujar la flecha igual prometería un orden que el servidor no va a aplicar.
 */
export function RoutesTable({
  rows,
  meta,
  members,
  filtered,
}: {
  rows: RouteItem[];
  meta: PageMeta;
  members: Member[];
  filtered: boolean;
}) {
  const t = useTranslations('panel.routes');
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  const columns: Column<RouteItem>[] = [
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

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      meta={meta}
      empty={
        // Sin rutas ese día y sin resultados con esos filtros no son lo mismo: uno se arregla
        // cambiando de día, el otro quitando un filtro.
        <EmptyState
          title={filtered ? t('noResults') : t('empty')}
          text={filtered ? t('noResultsText') : t('emptyText')}
        />
      }
    />
  );
}
