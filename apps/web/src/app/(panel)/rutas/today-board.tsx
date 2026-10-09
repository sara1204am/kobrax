import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { memberName, RouteStatus, type Member, type RouteItem } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { money } from '@/lib/format';
import { ROUTE_STATUS_TONE, routePercent, summarizeByCollector, todayRows, totalWork } from '@/lib/routes';
import { StartRouteButton } from './start-route-button';

/**
 * «Hoy»: **¿qué pasa hoy con las rutas?** (F4/12).
 *
 * Un renglón por cobrador, con lo que se viene a mirar: en qué estado está su ruta, cuánto lleva hecho, cuánto cobró y
 * qué parada sigue — y **una sola acción** según el caso: «Iniciar» si es suya y está planificada, «Ver» si ya existe,
 * «Planificar» si todavía no tiene (la pregunta del día es tanto «¿cómo va cada una?» como «¿a quién le falta?»).
 *
 * Arriba, los mismos cuatro totales de siempre, calculados con la cuenta que ya usa el período: dos pantallas que
 * suman las mismas rutas no pueden decir cosas distintas.
 *
 * Es del servidor: no tiene una sola interacción más que el botón de iniciar, que es un componente aparte.
 */
export async function TodayBoard({
  day,
  routes,
  collectors,
  members,
  userId,
  canPlan,
}: {
  day: string;
  routes: RouteItem[];
  /** Los cobradores que se muestran aunque no tengan ruta. Vacío para quien solo ve la suya. */
  collectors: Member[];
  /** Todo el equipo visible, para poner nombre a cada ruta (también la de quien ya no está activo). */
  members: Member[];
  userId?: string;
  canPlan: boolean;
}) {
  const t = await getTranslations('panel.routes');
  const names = new Map([...members, ...collectors].map((m) => [m.userId, memberName(m)]));
  const nameOf = (id: string) => names.get(id) ?? t('unknownCollector');
  const rows = todayRows(routes, collectors, nameOf);
  const total = totalWork(summarizeByCollector(routes));

  const stats = [
    { key: 'collectors', value: total.collectors },
    { key: 'stops', value: total.stops, strong: true },
    { key: 'done', value: total.done },
    { key: 'pending', value: total.pending },
  ];

  return (
    <>
      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.key} className="rounded-xl border border-k-border bg-white px-4 py-3.5 shadow-k-card">
            <dd className={`text-[26px] font-semibold tabular-nums leading-tight ${s.strong ? 'text-k-navy' : 'text-k-text'}`}>{s.value}</dd>
            <dt className="mt-0.5 text-[12px] text-k-text-2">{t(`todayBoard.stats.${s.key}`)}</dt>
          </div>
        ))}
      </dl>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-k-border bg-white px-5 py-8 text-center text-[14px] text-k-text-2">{t('todayBoard.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-k-border bg-white shadow-k-card">
          <table className="w-full min-w-[820px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-k-border text-[12px] font-medium text-k-text-2">
                {['collector', 'status', 'stops', 'progress', 'collected', 'next'].map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-medium">
                    {t(`todayBoard.cols.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('todayBoard.cols.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-k-border">
              {rows.map(({ collectorId, route }) => {
                const mine = !!userId && (route?.collectorId === userId || route?.createdBy === userId);
                const percent = route ? routePercent(route) : 0;
                return (
                  <tr key={collectorId} className="hover:bg-k-bg/60">
                    <td className="px-4 py-3 font-medium text-k-text">{nameOf(collectorId)}</td>
                    <td className="px-4 py-3">
                      {route ? (
                        <Badge tone={ROUTE_STATUS_TONE[route.status]} dot>
                          {t(`status.${route.status}`)}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">{t('todayBoard.noRoute')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-k-text-2">
                      {route ? t('progress', { done: route.visitedCount ?? 0, total: route.totalCases }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {route ? (
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
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-k-text">
                      {route && route.collected != null ? money(route.collected, 'BOB') : '—'}
                    </td>
                    <td className="px-4 py-3 text-k-text-2">
                      {route?.nextStop ? (
                        <span className="block max-w-[220px] truncate">
                          <span className="tabular-nums text-k-navy">#{route.nextStop.sequenceOrder}</span> · {route.nextStop.clientName ?? '—'}
                        </span>
                      ) : route && route.status !== RouteStatus.CANCELLED && (route.visitedCount ?? 0) >= route.totalCases && route.totalCases > 0 ? (
                        t('todayBoard.allDone')
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {route ? (
                        route.status === RouteStatus.PLANNED && mine ? (
                          <StartRouteButton routeId={route.id} />
                        ) : (
                          <Link
                            href={`/rutas/${route.id}`}
                            className="inline-flex h-8 items-center rounded-lg border border-k-border bg-white px-3.5 text-[13px] font-medium text-k-slate hover:bg-k-bg"
                          >
                            {t('todayBoard.view')}
                          </Link>
                        )
                      ) : canPlan ? (
                        <Link
                          href={`/rutas/planificar?date=${day}&collectorId=${collectorId}`}
                          className="inline-flex h-8 items-center rounded-lg border border-k-periwinkle bg-k-highlight px-3.5 text-[13px] font-medium text-k-periwinkle hover:bg-k-light-bg"
                        >
                          {t('todayBoard.plan')}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
