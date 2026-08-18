'use client';

import { useLocale, useTranslations } from 'next-intl';
import { memberName, type Member, type RouteItem } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column } from '@/components/data-table';
import { dayDate } from '@/lib/format';
import { ROUTE_STATUS_TONE, type CollectorWork } from '@/lib/routes';

/**
 * Qué hizo cada cobrador en el período.
 *
 * 🔴 **Una fila por persona, no por ruta.** Es la pregunta que la vista diaria no podía contestar:
 * «¿cuántas paradas hizo cada uno esta semana?». Las rutas sueltas siguen estando — en el día, y en
 * la etapa que sigue al abrir la fila.
 *
 * 🔴 **No hay columna de distancia**, y es una decisión, no un olvido: `totalDistanceKm` sólo se
 * llena cuando alguien abre la vista previa del recorrido en el teléfono. Sumarla por cobrador sería
 * sumar ceros de quien no la abrió con kilómetros de quien sí, y presentarlo como el trabajo de la
 * semana.
 *
 * El orden se resuelve **en memoria y es exacto**: acá llega el período completo, no una página.
 */
export function CollectorWorkTable({
  rows,
  routes,
  members,
  filtered,
  truncated,
}: {
  rows: CollectorWork[];
  /** Las rutas del período, para el detalle de la fila. Ya están en la pantalla: no se piden de nuevo. */
  routes: RouteItem[];
  members: Member[];
  filtered: boolean;
  /** El período trajo más rutas de las que se pueden traer: los números son de una parte. */
  truncated?: boolean;
}) {
  const t = useTranslations('panel.routes');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));
  const nombre = (id: string) => byId.get(id) ?? t('unknownCollector');

  const columns: Column<CollectorWork>[] = [
    {
      key: 'collector',
      header: t('columns.collector'),
      // Sin nombre no es sin cobrador: `/users` da 403 sin `user:read`.
      render: (w) => <span className="font-medium text-k-text">{nombre(w.collectorId)}</span>,
    },
    { key: 'days', header: t('work.days'), numeric: true, render: (w) => w.days },
    {
      key: 'stops',
      header: t('work.stops'),
      numeric: true,
      render: (w) => <span className="font-semibold text-k-text">{w.stops}</span>,
    },
    {
      key: 'done',
      header: t('work.done'),
      numeric: true,
      render: (w) => <span className={w.done > 0 ? 'text-k-success' : 'text-k-muted'}>{w.done}</span>,
    },
    {
      key: 'pending',
      header: t('work.pending'),
      numeric: true,
      // Sin gestionar no es rojo: en un período que llega hasta mañana, lo que falta todavía no
      // llegó tarde. El rojo del panel está reservado para lo que hay que atender hoy.
      render: (w) => <span className={w.pending > 0 ? 'text-k-text-2' : 'text-k-muted'}>{w.pending}</span>,
    },
    // Arranca apagada: interesa cuando dos personas tienen las mismas paradas en distinta cantidad
    // de salidas, no todos los días.
    { key: 'routes', header: t('work.routes'), numeric: true, visibleByDefault: false, render: (w) => w.routes },
  ];

  return (
    <>
      {truncated && (
        <p className="mb-3 rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
          {t('work.truncated')}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(w) => w.collectorId}
        // Una página: acá llega el período entero ya agregado, y son tantas filas como cobradores.
        meta={{ total: rows.length, page: 1, limit: Math.max(1, rows.length), pages: 1 }}
        entityLabel={t('work.entity')}
        /*
         * Abrir la fila muestra **los días de esa persona**, con las rutas que ya están en la
         * pantalla: no se pide nada más al abrir. Es el paso que faltaba entre «Ana hizo 42
         * paradas» y la jornada concreta en la que hay que mirar.
         */
        expand={{
          label: (w) => t('work.expand', { name: nombre(w.collectorId) }),
          render: (w) => <DaysOfCollector routes={routes.filter((r) => r.collectorId === w.collectorId)} locale={locale} t={t} />,
        }}
        empty={<EmptyState title={t('emptyPeriod')} text={t('emptyPeriodText')} />}
        noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
        filtered={filtered}
      />
    </>
  );
}

/**
 * Los días de un cobrador dentro de su fila: uno por ruta, del más nuevo al más viejo.
 *
 * 🔴 **No es otra tabla**: es una lista adentro de la fila, con menos peso visual que la de arriba.
 * Una tabla igual pegada debajo se lee como si la pantalla se hubiera duplicado, y ahí se pierde de
 * vista quién es el dueño de esos días.
 *
 * Cada día linkea a **la ruta de ese día**, que es donde están las paradas y el mapa: la pantalla
 * ya existe desde W6 y no hacía falta una nueva.
 */
function DaysOfCollector({
  routes,
  locale,
  t,
}: {
  routes: RouteItem[];
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const ordenadas = [...routes].sort((a, b) => b.plannedDate.localeCompare(a.plannedDate));

  return (
    <ul className="divide-y divide-k-border rounded-xl border border-k-border bg-white">
      {ordenadas.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
          <a href={`/rutas/${r.id}`} className="min-w-[110px] font-medium text-k-text hover:underline">
            {dayDate(r.plannedDate, locale)}
          </a>
          <Badge tone={ROUTE_STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
          <span className="tabular-nums text-k-text-2">
            {t('work.dayStops', { done: r.visitedCount ?? 0, total: r.totalCases })}
          </span>
        </li>
      ))}
    </ul>
  );
}
