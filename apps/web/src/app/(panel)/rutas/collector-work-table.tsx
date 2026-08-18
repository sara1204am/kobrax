'use client';

import { useTranslations } from 'next-intl';
import { memberName, type Member } from '@kobrax/shared';
import { EmptyState } from '@/components/panel-ui';
import { DataTable, type Column } from '@/components/data-table';
import type { CollectorWork } from '@/lib/routes';

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
  members,
  filtered,
  truncated,
}: {
  rows: CollectorWork[];
  members: Member[];
  filtered: boolean;
  /** El período trajo más rutas de las que se pueden traer: los números son de una parte. */
  truncated?: boolean;
}) {
  const t = useTranslations('panel.routes');
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  const columns: Column<CollectorWork>[] = [
    {
      key: 'collector',
      header: t('columns.collector'),
      render: (w) => (
        <span className="font-medium text-k-text">
          {/* Sin nombre no es sin cobrador: `/users` da 403 sin `user:read`. */}
          {byId.get(w.collectorId) ?? t('unknownCollector')}
        </span>
      ),
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
        empty={<EmptyState title={t('emptyPeriod')} text={t('emptyPeriodText')} />}
        noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
        filtered={filtered}
      />
    </>
  );
}
