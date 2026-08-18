import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Permission,
  RoleType,
  todayISO,
  type CaseListItem,
  type MeInfo,
  type Member,
  type RouteItem,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { shiftDay } from '@/lib/agenda';
import { availableQuery, hasPlanFilters, minStops, type PlanParams } from '@/lib/plan';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RetryState } from '@/components/retry-state';
import { PlanScreen } from './plan-screen';

/**
 * Planificar las rutas de un día, **de a un cobrador por vez**.
 *
 * 🔴 **La mora que se ofrece es la que se puede asignar de verdad**: abiertas, y sin las que ya son
 * parada de una ruta de ese día (`excludeRouted`). Una lista que muestre trabajo ya repartido manda
 * a dos cobradores a la misma puerta.
 *
 * 🔴 **Por defecto, cada uno lo suyo.** La lista arranca acotada a la cartera del cobrador elegido;
 * tomar la de otro es **ayuda de esa jornada** y hay que pedirlo con el filtro de cartera. El dueño
 * del caso **no cambia** al planificar: la parada guarda el caso, y la cartera sigue diciendo de
 * quién es la deuda.
 *
 * Abre en MAÑANA: planificar es preparar el trabajo que viene, el de hoy ya está en la calle.
 */
export default async function PlanificarPage({ searchParams }: { searchParams: PlanParams }) {
  const t = await getTranslations('panel.routes.planning');
  const day = searchParams.date ?? shiftDay(todayISO(), 1);

  const [me, team] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  // Sin `route:assign` no se le arma la ruta a nadie: la API lo rechazaría igual, y traer a la
  // persona hasta el último paso para decírselo ahí sería hacerle perder el trabajo.
  if (!me.body.data?.permissions?.includes(Permission.ROUTE_ASSIGN)) redirect('/rutas');

  /*
   * Sólo cobradores activos. Un supervisor con `route:execute` podría tener ruta, pero planificarle
   * la jornada a quien no sale a la calle es armar trabajo que nadie va a hacer.
   */
  const collectors = (team.body.data ?? []).filter((m) => m.roleName === RoleType.COLLECTOR && m.isActive);
  if (collectors.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState title={t('noCollectors')} text={t('noCollectorsText')} />
      </>
    );
  }

  // El primero de la lista si no se eligió a nadie: la pantalla siempre está planificándole a alguien.
  const collectorId = collectors.find((c) => c.userId === searchParams.collectorId)?.userId ?? collectors[0]!.userId;
  const params: PlanParams = { ...searchParams, collectorId };

  const [available, routes] = await Promise.all([
    apiCall<CaseListItem[]>(`/cases?${availableQuery(params, day)}`, { method: 'GET', auth: true }),
    // Las rutas del día: quién ya tiene la suya armada y con cuántas paradas.
    apiCall<RouteItem[]>(`/routes?date=${day}&limit=100`, { method: 'GET', auth: true }),
  ]);

  if (available.status !== 200 || !available.body.data) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <RetryState title={t('loadError')} text={available.body.error?.message} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <PlanScreen
        day={day}
        today={todayISO()}
        collectors={collectors}
        collectorId={collectorId}
        available={available.body.data}
        total={available.body.meta?.total ?? available.body.data.length}
        routes={routes.body.data ?? []}
        minStops={minStops(params)}
        filtered={hasPlanFilters(params)}
      />
    </>
  );
}
