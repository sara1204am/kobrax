import { getTranslations } from 'next-intl/server';
import { Permission, todayISO, type MeInfo, type Member, type RouteItem } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { dayOr } from '@/lib/agenda';
import {
  hasRouteFilters,
  routeLimit,
  routeMode,
  routePeriod,
  routeQuery,
  routeView,
  type RouteParams,
} from '@/lib/routes';
import { DayPicker } from '@/components/day-picker';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RouteTabs } from './route-tabs';
import { PeriodPicker } from './period-picker';
import { PlanningPanel } from './planning-panel';
import { RoutesTable } from './routes-table';

/**
 * Rutas: **planificar el trabajo de la calle y comprobar qué pasó**.
 *
 * Dos modos, en la URL: `historial` (el default, lo que existía) y `planificacion`. El historial se
 * mira de dos maneras: un `dia` —la jornada, que es como se usa todos los días— o un `periodo`, para
 * la pregunta que la vista diaria no podía contestar: «¿qué hizo el equipo esta semana?».
 *
 * 🔴 Igual que casos y agenda, **`GET /routes` acota por capacidad y la respuesta no lo dice**: con
 * `ROUTE_ASSIGN` se ven las de todo el equipo, sin ella sólo las propias. La señal la pone la
 * pantalla, porque el contrato no la trae.
 */
export default async function RutasPage({ searchParams }: { searchParams: RouteParams }) {
  const t = await getTranslations('panel.routes');
  const modo = routeMode(searchParams);
  const vista = routeView(searchParams);
  const today = todayISO();
  const day = dayOr(today, searchParams.date);
  const period = routePeriod(searchParams);

  const [me, team] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);
  const members = team.body.data ?? [];
  const supervises = me.body.data?.permissions?.includes(Permission.ROUTE_ASSIGN) ?? false;

  const header = (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <RouteTabs modo={modo} vista={vista} />
    </>
  );

  if (modo === 'planificacion') {
    return (
      <>
        {header}
        <PlanningPanel canPlan={supervises} />
      </>
    );
  }

  /*
   * O el día, o el rango. `routeQuery` no manda los dos: la API le da prioridad al día —es lo que
   * pide el teléfono— así que mandarlos juntos devolvería una jornada y la pantalla mostraría una
   * semana con una sola fecha adentro.
   */
  const list = await apiCall<RouteItem[]>(
    `/routes?${routeQuery(
      vista === 'periodo' ? { ...searchParams, period } : { ...searchParams, date: day },
    )}`,
    { method: 'GET', auth: true },
  );

  if (list.status !== 200 || !list.body.data) {
    return (
      <>
        {header}
        <EmptyState title={t('title')} text={list.body.error?.message} />
      </>
    );
  }

  return (
    <>
      {header}

      {!supervises && (
        <p className="mb-4 rounded-xl border border-k-border bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
          {t('scopedToMine')}
        </p>
      )}

      {vista === 'dia' ? (
        <DayPicker
          day={day}
          today={today}
          labels={{ previous: t('previousDay'), next: t('nextDay'), today: t('today'), date: t('date') }}
        />
      ) : (
        <PeriodPicker from={period.from} to={period.to} />
      )}

      <RoutesTable
        rows={list.body.data}
        meta={pageMeta(list.body, searchParams.page, routeLimit(searchParams))}
        members={members}
        filtered={hasRouteFilters(searchParams)}
        userId={me.body.data?.userId}
        // Sin `route:assign` la API acota a lo propio, y sin `user:read` no hay nombres que ofrecer.
        showCollector={supervises && members.length > 0}
        period={vista === 'periodo'}
      />
    </>
  );
}
