import { Report, arrearsTone, C, type TableColumn } from '../../common/pdf/report';
import type { serializeRoute } from './routes.serializer';

type Route = ReturnType<typeof serializeRoute>;
type Stop = NonNullable<Route['stops']>[number];

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planificada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const STOP_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  VISITED: 'Gestionada',
  SKIPPED: 'Omitida',
};

export interface RoutePdfContext {
  accountName: string;
  currency?: string;
  /** Nombre del cobrador; el serializer sólo trae su id. */
  collectorName?: string;
}

/**
 * La hoja de ruta impresa: qué se va a cobrar hoy, en orden, con la dirección y la mora — para
 * salir a la calle sin depender del teléfono. La PII ya viene revelada y auditada por
 * `RoutesService.findOne`; esto sólo la dibuja.
 */
export async function buildRoutePdf(route: Route, ctx: RoutePdfContext): Promise<Buffer> {
  const stops = route.stops ?? [];
  const day = new Date(route.plannedDate).toLocaleDateString('es-BO', { dateStyle: 'full' });

  const r = new Report({
    title: 'Hoja de ruta',
    subtitle: [ctx.collectorName, day].filter(Boolean).join(' · '),
    accountName: ctx.accountName,
    currency: ctx.currency,
  });

  const totalMora = stops.reduce((s, x) => s + (x.overdueAmount ?? 0), 0);
  const gestionadas = stops.filter((s) => s.status === 'VISITED').length;
  const peorMora = stops.reduce((m, s) => Math.max(m, s.daysPastDue ?? 0), 0);

  r.kpis([
    { label: 'Paradas', value: String(stops.length) },
    { label: 'Por cobrar', value: r.fmtMoney(totalMora), tone: 'money' },
    { label: 'Gestionadas', value: `${gestionadas} de ${stops.length}`, tone: 'accent' },
    { label: 'Mora máxima', value: `${peorMora} d`, tone: peorMora > 30 ? 'danger' : 'warn' },
  ]);

  r.section(`Recorrido — ${STATUS_LABEL[route.status] ?? route.status}`);

  const columns: TableColumn<Stop>[] = [
    { header: '#', width: 5, value: (s) => String(s.sequenceOrder), align: 'center', strong: true },
    { header: 'Deudor', width: 25, value: (s) => s.clientName ?? 'Sin nombre', strong: true },
    { header: 'Dirección', width: 30, value: (s) => s.address ?? '—' },
    {
      header: 'Mora',
      width: 9,
      value: (s) => (s.daysPastDue != null ? `${s.daysPastDue} d` : '—'),
      align: 'right',
      tone: (s) => (s.daysPastDue != null ? arrearsTone(s.daysPastDue) : undefined),
    },
    {
      header: 'A cobrar',
      width: 15,
      value: (s) => (s.overdueAmount != null ? r.fmtMoney(s.overdueAmount) : '—'),
      align: 'right',
      strong: true,
    },
    {
      // 16 y no 11: con menos, «Gestionada» se partía en dos líneas y estiraba toda la fila.
      header: 'Estado',
      width: 16,
      value: (s) => STOP_LABEL[s.status] ?? s.status,
      tone: (s) => (s.status === 'VISITED' ? C.success : s.status === 'SKIPPED' ? C.muted : C.text2),
    },
  ];

  r.table(columns, stops, { empty: 'Esta ruta todavía no tiene paradas.' });

  if (route.totalDistanceKm != null || route.estimatedMinutes != null) {
    const partes = [
      route.totalDistanceKm != null ? `${route.totalDistanceKm.toFixed(1)} km` : null,
      route.estimatedMinutes != null ? `${route.estimatedMinutes} min estimados` : null,
    ].filter(Boolean);
    r.note(`Recorrido calculado: ${partes.join(' · ')}.`);
  }

  return r.finish();
}
