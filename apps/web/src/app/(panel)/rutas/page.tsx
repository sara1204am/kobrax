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
  summarizeByCollector,
  type RouteParams,
} from '@/lib/routes';
import { DayPicker } from '@/components/day-picker';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RouteTabs } from './route-tabs';
import { PeriodPicker } from './period-picker';
import { PlanningPanel } from './planning-panel';
import { RoutesTable } from './routes-table';
import { CollectorWorkTable } from './collector-work-table';
import { WorkSummary } from './work-summary';

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
  const list =
    vista === 'periodo'
      ? await allRoutes({ ...searchParams, period })
      : await apiCall<RouteItem[]>(`/routes?${routeQuery({ ...searchParams, date: day })}`, {
          method: 'GET',
          auth: true,
        });

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
        <>
          <DayPicker
            day={day}
            today={today}
            labels={{ previous: t('previousDay'), next: t('nextDay'), today: t('today'), date: t('date') }}
          />
          <RoutesTable
            rows={list.body.data}
            meta={pageMeta(list.body, searchParams.page, routeLimit(searchParams))}
            members={members}
            filtered={hasRouteFilters(searchParams)}
            userId={me.body.data?.userId}
            // Sin `route:assign` la API acota a lo propio, y sin `user:read` no hay nombres que ofrecer.
            showCollector={supervises && members.length > 0}
          />
        </>
      ) : (
        /*
         * El período agrupa **por persona**: una semana son ~77 rutas y leerlas de a una no contesta
         * «¿cuántas paradas hizo cada uno?», que es para lo que se abre esta vista. Las rutas
         * sueltas del período vuelven al abrir la fila, en la etapa que sigue.
         */
        <>
          <PeriodPicker from={period.from} to={period.to} />
          <WorkSummary rows={summarizeByCollector(list.body.data)} />
          <CollectorWorkTable
            rows={summarizeByCollector(list.body.data)}
            routes={list.body.data}
            members={members}
            filtered={hasRouteFilters(searchParams)}
            // Sólo el camino del período puede venir recortado; el del día trae una página y punto.
            truncated={'truncated' in list && list.truncated === true}
          />
        </>
      )}
    </>
  );
}

/** Cuántas páginas de rutas se traen para agregar un período. 5 × 100 = 500 rutas. */
const MAX_PAGES = 5;

/**
 * Todas las rutas del período, no una página.
 *
 * 🔴 **Agregar sobre una página sería mentir con números redondos**: la tabla diría «Ana: 25
 * paradas» porque el corte cayó ahí, no porque haya hecho 25. Por eso se pide la primera página al
 * máximo que la API acepta (`limit ≤ 100`), y si hay más se traen en paralelo.
 *
 * ponytail: con un techo de 5 páginas — 500 rutas, o sea unos 45 días de once cobradores. Pasado
 * eso **se avisa en la pantalla** en vez de recortar en silencio; el día que ese techo moleste, lo
 * que corresponde es un endpoint que agregue del lado del servidor, no diez llamadas más.
 */
async function allRoutes(
  params: RouteParams & { period: { from: string; to: string } },
): Promise<Awaited<ReturnType<typeof apiCall<RouteItem[]>>> & { truncated?: boolean }> {
  // Sin `sort`: el orden del resumen lo decide la tabla, sobre el período ya completo.
  const query = (page: number) =>
    routeQuery({ ...params, sort: undefined, dir: undefined, page: String(page), pageSize: '100' });

  const first = await apiCall<RouteItem[]>(`/routes?${query(1)}`, { method: 'GET', auth: true });
  if (first.status !== 200 || !first.body.data) return first;

  const pages = first.body.meta?.pages ?? 1;
  if (pages <= 1) return first;

  const rest = await Promise.all(
    Array.from({ length: Math.min(pages, MAX_PAGES) - 1 }, (_, i) =>
      apiCall<RouteItem[]>(`/routes?${query(i + 2)}`, { method: 'GET', auth: true }),
    ),
  );

  return {
    ...first,
    body: { ...first.body, data: [...first.body.data, ...rest.flatMap((r) => r.body.data ?? [])] },
    truncated: pages > MAX_PAGES,
  };
}
