'use client';

import { useLocale, useTranslations } from 'next-intl';
import { memberName, RouteStatus, type Member, type RouteItem } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { dayDate } from '@/lib/format';
import { ROUTE_STATUS_TONE } from '@/lib/routes';

/**
 * Las rutas de un día o de un período.
 *
 * 🔴 **Es el formato de la cartera, no una tabla aparte**: mismo `DataTable`, filtros en el panel
 * del costado, columnas configurables y tamaño de página. Antes tenía su propia fila de
 * desplegables encima de la tabla, así que las listas del panel se operaban distinto para hacer lo
 * mismo.
 *
 * **Ordenan tres columnas: cobrador, estado y fecha** (`ROUTE_SORTS`), y **las resuelve el
 * servidor** — ordenar acá ordenaría las 25 filas de la página y dejaría al resto del período donde
 * estaba. Paradas y distancia no ordenan a propósito: el motivo está en `ROUTE_SORTS`.
 *
 * **Y no hay búsqueda**: el listado no acepta `?q=`. Una caja que no busca es peor que ninguna.
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
      key: 'date',
      header: t('columns.date'),
      sortable: true,
      // Lo último primero: en un período, la jornada de ayer importa más que la de hace tres semanas.
      defaultDir: 'desc',
      render: (r) => <span className="whitespace-nowrap text-k-text-2">{dayDate(r.plannedDate, locale)}</span>,
    },
    {
      key: 'collector',
      header: t('columns.collector'),
      // Alfabético por apellido, que es como se busca a alguien en una lista de gente.
      sortable: true,
      defaultDir: 'asc',
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
      sortable: true,
      defaultDir: 'asc',
      render: (r) => <Badge tone={ROUTE_STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>,
    },
    {
      key: 'stops',
      header: t('columns.stops'),
      numeric: true,
      /*
       * **«5 / 8»: lo hecho sobre lo planificado.** `visitedCount` lo agrega el listado desde las
       * paradas (W10-F1b); antes acá sólo se podía mostrar el total, y una ruta a medias se leía
       * igual que una terminada.
       *
       * Si el contador no viene —una API vieja— se muestra el total solo, que es lo que había. No
       * se dibuja «0 / 8» sobre un dato que no llegó: eso sería decir que no se visitó nada.
       */
      render: (r) =>
        r.visitedCount == null ? (
          r.totalCases
        ) : (
          <span className={r.visitedCount >= r.totalCases && r.totalCases > 0 ? 'font-semibold text-k-success' : ''}>
            {r.visitedCount} / {r.totalCases}
          </span>
        ),
    },
    {
      key: 'distance',
      header: t('columns.distance'),
      numeric: true,
      render: (r) => (r.totalDistanceKm != null ? t('km', { n: r.totalDistanceKm.toFixed(1) }) : '—'),
    },
    /*
     * Acá iba «Duración». Se sacó porque el número no se gana la columna: `estimatedMinutes` sólo se
     * llena cuando alguien abre la vista previa del recorrido en el teléfono (OSRM + 10 min por
     * parada), así que una ruta que nadie previsualizó no tiene ninguno, y el que se ve en los datos
     * de demo es un aleatorio del seed. Vuelve el día que el dato se calcule solo.
     */
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
