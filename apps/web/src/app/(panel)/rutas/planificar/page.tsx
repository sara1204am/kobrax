import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Permission,
  RoleType,
  todayISO,
  type AgendaListItem,
  type ArrearCategory,
  type MeInfo,
  type MoraCreditListItem,
  type Member,
  type RouteItem,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAgendaSummary } from '@/lib/agenda-summary';
import { shiftDay } from '@/lib/agenda';
import { availableQuery, hasPlanFilters, minStops, toAvailable, type PlanParams } from '@/lib/plan';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RetryState } from '@/components/retry-state';
import { PlanScreen, type PlannedVisit } from './plan-screen';

/**
 * Planificar las rutas de un día, **de a un cobrador por vez y en cuatro pasos** (F4/12): fecha y cobrador, clientes y
 * ubicaciones, mapa y orden, vista previa y publicar.
 *
 * 🔴 **Lo que se ofrece son créditos EN MORA** (`GET /mora`, F4/08: la parada es por crédito) de quien
 * es su responsable. Un cobrador con ruta ese día ya no se planifica de nuevo (la pantalla lo dice).
 *
 * 🔴 **Por defecto, cada uno lo suyo.** La lista arranca acotada a la cartera del cobrador elegido;
 * tomar la de otro es **ayuda de esa jornada** y hay que pedirlo con el filtro de cartera. El
 * responsable del crédito **no cambia** al planificar: la parada guarda el crédito, y la cartera
 * sigue diciendo de quién es la deuda.
 *
 * Abre en MAÑANA: planificar es preparar el trabajo que viene, el de hoy ya está en la calle.
 */
export default async function PlanificarPage({ searchParams }: { searchParams: PlanParams }) {
  const t = await getTranslations('panel.routes.planning');
  // «Hoy» es el de la EMPRESA: en Bolivia, desde las 20:00 el servidor ya está en mañana y «mañana» sería pasado mañana.
  const today = (await getAgendaSummary())?.date ?? todayISO();
  const day = searchParams.date ?? shiftDay(today, 1);

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

  const [available, routes, categories, agenda] = await Promise.all([
    apiCall<MoraCreditListItem[]>(`/mora?${availableQuery(params, day)}`, { method: 'GET', auth: true }),
    // Las rutas del día: quién ya tiene la suya armada y con cuántas paradas.
    apiCall<RouteItem[]>(`/routes?date=${day}&limit=100`, { method: 'GET', auth: true }),
    // Para el filtro de categoría; si falla (sin permiso) el filtro simplemente no se dibuja.
    apiCall<ArrearCategory[]>('/arrear-categories', { method: 'GET', auth: true }),
    // Las visitas agendadas de ese día: entran solas a la ruta de su responsable, así que se muestran antes de armarla.
    apiCall<AgendaListItem[]>(`/agenda?date=${day}`, { method: 'GET', auth: true }).catch(() => null),
  ]);

  const visits: PlannedVisit[] = (agenda?.body.data ?? [])
    .filter((i) => i.type === 'VISIT' && i.status === 'SCHEDULED' && i.assigneeId === collectorId)
    .map((i) => ({
      id: i.id,
      creditId: i.creditId,
      clientName: i.clientName,
      creditCode: i.creditCode,
      time: i.timeMode === 'FIXED' ? i.scheduledTime : undefined,
      priority: i.priorityCode,
    }));

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
        today={today}
        collectors={collectors}
        collectorId={collectorId}
        available={available.body.data.map(toAvailable)}
        total={available.body.meta?.total ?? available.body.data.length}
        routes={routes.body.data ?? []}
        minStops={minStops(params)}
        filtered={hasPlanFilters(params)}
        categories={(categories.body.data ?? []).map((c) => ({ code: c.code, name: c.name }))}
        visits={visits}
      />
    </>
  );
}
