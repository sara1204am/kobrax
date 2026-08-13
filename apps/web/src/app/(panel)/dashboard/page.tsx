import { getTranslations } from 'next-intl/server';
import { Permission, type AnalyticsSummary, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { analyticsQuery, dashboardFilters } from '@/lib/dashboard';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { DashboardFilters } from '@/components/dashboard/dashboard-filters';
import { KpiWidget } from '@/components/dashboard/widgets/kpi-widget';
import { WidgetFrame } from '@/components/dashboard/widget-frame';
import { money, percent } from '@/lib/format';

/**
 * El tablero de la gerencia.
 *
 * 🔴 **Es el aterrizaje de todo el mundo**: acá caen `app/page.tsx`, el login y el selector de
 * empresa. Si esta pantalla revienta, el panel entero parece roto — por eso ningún fallo de un
 * widget tumba la página: cada uno muestra su propio error y los demás siguen mostrando su dato.
 *
 * La grilla es **CSS puro de 12 columnas**. Arrastrar y redimensionar llegan con el modo Editar
 * (T7), y recién ahí se justifica la librería de grid: en modo Ver no hay nada que arrastrar, y
 * pagarla igual sería 30 kB para dibujar cajas.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const t = await getTranslations('panel.dashboard');
  const filters = dashboardFilters(searchParams);
  const query = analyticsQuery(filters);

  const [summary, me, team] = await Promise.all([
    apiCall<AnalyticsSummary>(`/analytics/summary?${query}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  // Sin `report:read` no hay tablero, y decirlo es mejor que dibujar seis cajas vacías.
  if (!(me.body.data?.permissions ?? []).includes(Permission.REPORT_READ)) {
    return <EmptyState title={t('title')} text={t('noAccess')} />;
  }

  const kpi = summary.body.data;
  const currency = kpi?.currency ?? 'BOB';
  const amount = (value: number): string => money(value, currency);
  const count = (value: number): string => value.toLocaleString('es-BO');

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Los filtros van ANTES de los números: primero se elige qué se mira. */}
      <DashboardFilters collectors={team.body.data ?? []} />

      <div className="grid grid-cols-12 gap-4">
        {kpi ? (
          <>
            <KpiWidget label={t('kpi.outstanding')} kpi={kpi.outstanding} format={amount} />
            <KpiWidget label={t('kpi.overdue')} kpi={kpi.overdue} format={amount} />
            <KpiWidget label={t('kpi.overdueRate')} kpi={kpi.overdueRate} format={percent} />
            <KpiWidget label={t('kpi.activeCases')} kpi={kpi.activeCases} format={count} />
            <KpiWidget label={t('kpi.collected')} kpi={kpi.collected} format={amount} />
          </>
        ) : (
          <div className="col-span-12">
            <EmptyState title={t('title')} text={summary.body.error?.message ?? t('error')} />
          </div>
        )}

        {/* Los seis widgets de datos llegan en T5. Se dibujan sus marcos para que la grilla se
            pueda mirar y medir de verdad, y cada uno dice que todavía no tiene su dato — que es
            distinto de decir que no hay datos. */}
        <WidgetFrame title={t('widgets.aging')} span={4} empty={t('soon')} />
        <WidgetFrame title={t('widgets.agingBars')} span={4} empty={t('soon')} />
        <WidgetFrame title={t('widgets.agenda')} span={4} empty={t('soon')} />
        <WidgetFrame title={t('widgets.collectors')} span={5} empty={t('soon')} />
        <WidgetFrame title={t('widgets.map')} span={4} empty={t('soon')} />
        <WidgetFrame title={t('widgets.indicators')} span={3} empty={t('soon')} />
        <WidgetFrame title={t('widgets.trend')} span={12} empty={t('soon')} />
      </div>
    </>
  );
}
