import { getTranslations } from 'next-intl/server';
import {
  Permission,
  type AgendaSummary,
  type AgingBucketRow,
  type AnalyticsSummary,
  type CollectorPerformanceRow,
  type DashboardDefinition,
  type MeInfo,
  type Member,
  type TrendPoint,
  type VisitMapPoint,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { analyticsQuery, dashboardFilters } from '@/lib/dashboard';
import { DEFAULT_WIDGETS } from '@/lib/widget-registry';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { DashboardFilters } from '@/components/dashboard/dashboard-filters';
import { DashboardGrid } from '@/components/dashboard/dashboard-grid';
import { DashboardToolbar } from '@/components/dashboard/dashboard-toolbar';
import { WidgetActions } from '@/components/dashboard/widget-actions';
import { WidgetRenderer, type DashboardData } from '@/components/dashboard/widget-renderer';

/**
 * El tablero de la gerencia.
 *
 * 🔴 **Es el aterrizaje de todo el mundo**: acá caen `app/page.tsx`, el login y el selector de
 * empresa. Si esta pantalla revienta, el panel entero parece roto — por eso ningún fallo de un
 * widget tumba la página: cada uno muestra su propio error y los demás siguen mostrando su dato.
 *
 * **Un tablero es una fila de la base, no este archivo.** Lo que hay acá es el reparto: pedir los
 * datos una vez, y dejar que el renderer decida qué componente le toca a cada widget guardado. Por
 * eso «Vista general», «Cobranza» y «Campo» son el mismo código.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const t = await getTranslations('panel.dashboard');
  const filters = dashboardFilters(searchParams);
  const query = analyticsQuery(filters);
  const editable = searchParams.edit === '1';

  /*
   * Todo en paralelo, no encadenado: la pantalla tarda lo que el más lento y no la suma de los ocho.
   */
  const [summary, aging, collectors, agenda, visits, trend, boards, me, team] = await Promise.all([
    apiCall<AnalyticsSummary>(`/analytics/summary?${query}`, { method: 'GET', auth: true }),
    apiCall<AgingBucketRow[]>(`/analytics/portfolio-aging?${query}`, { method: 'GET', auth: true }),
    apiCall<CollectorPerformanceRow[]>(`/analytics/collector-performance?${query}`, { method: 'GET', auth: true }),
    apiCall<AgendaSummary>(`/analytics/agenda-summary?${query}`, { method: 'GET', auth: true }),
    apiCall<VisitMapPoint[]>(`/analytics/visit-map?${query}`, { method: 'GET', auth: true }),
    apiCall<TrendPoint[]>(`/analytics/collection-trend?${query}`, { method: 'GET', auth: true }),
    apiCall<DashboardDefinition[]>('/dashboards', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  // Sin `report:read` no hay tablero, y decirlo es mejor que dibujar doce cajas vacías.
  if (!(me.body.data?.permissions ?? []).includes(Permission.REPORT_READ)) {
    return <EmptyState title={t('title')} text={t('noAccess')} />;
  }

  /*
   * Qué tablero se mira: el pedido por la URL, el predeterminado, o el primero. Y si la cuenta
   * **todavía no guardó ninguno**, el del código — que se vuelve fila recién cuando alguien toca
   * algo. Sembrarlo en la base haría que una cuenta nueva arranque con filas que nadie pidió, y que
   * borrarlo deje la pantalla vacía para siempre.
   */
  const dashboards = boards.body.data ?? [];
  const current =
    dashboards.find((d) => d.id === searchParams.view) ?? dashboards.find((d) => d.isDefault) ?? dashboards[0];
  const widgets = current?.widgets.length ? current.widgets : DEFAULT_WIDGETS;

  const data: DashboardData = {
    summary: summary.body.data ?? undefined,
    aging: aging.body.data ?? undefined,
    collectors: collectors.body.data ?? undefined,
    agenda: agenda.body.data ?? undefined,
    visits: visits.body.data ?? undefined,
    trend: trend.body.data ?? undefined,
    members: team.body.data ?? [],
    currency: summary.body.data?.currency ?? 'BOB',
    errors: {
      summary: summary.body.error?.message,
      aging: aging.body.error?.message,
      collectors: collectors.body.error?.message,
      agenda: agenda.body.error?.message,
      visits: visits.body.error?.message,
      trend: trend.body.error?.message,
    },
  };

  return (
    <>
      <PageHeader title={current?.name ?? t('title')} subtitle={t('subtitle')} />

      <DashboardToolbar dashboards={dashboards} current={current} widgets={widgets} editable={editable} />

      {/* Los filtros van ANTES de los números: primero se elige qué se mira. */}
      <DashboardFilters collectors={team.body.data ?? []} />

      <DashboardGrid dashboardId={current?.id} widgets={widgets} editable={editable}>
        {widgets.map((widget) => (
          // El `div` es de la grilla, que le pone posición y medida; el marco vive adentro.
          <div key={widget.id}>
            {/* @ts-expect-error — server component asíncrono dentro de un client component: Next lo
                soporta (los children se renderizan en el servidor), pero los tipos de React 18 no
                lo expresan todavía. */}
            <WidgetRenderer
              widget={widget}
              data={data}
              editable={editable}
              actions={
                editable ? <WidgetActions widget={widget} widgets={widgets} dashboardId={current?.id} /> : undefined
              }
            />
          </div>
        ))}
      </DashboardGrid>
    </>
  );
}
