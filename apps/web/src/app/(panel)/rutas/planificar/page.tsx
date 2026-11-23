import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  Permission,
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
import { availableQuery, hasPlanFilters, minStops, planningTargets, toAvailable, type PlanParams } from '@/lib/plan';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RetryState } from '@/components/retry-state';
import { PlanScreen, type PlannedVisit } from './plan-screen';
import { requirePermission } from '@/lib/authz';

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
  const blocked = await requirePermission(Permission.ROUTE_READ);
  if (blocked) return blocked;
  const t = await getTranslations('panel.routes.planning');
  // «Hoy» es el de la EMPRESA: en Bolivia, desde las 20:00 el servidor ya está en mañana y «mañana» sería pasado mañana.
  const today = (await getAgendaSummary())?.date ?? todayISO();
  const [me, team] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  // Sin `route:assign` no se le arma la ruta a nadie: la API lo rechazaría igual, y traer a la
  // persona hasta el último paso para decírselo ahí sería hacerle perder el trabajo.
  if (!me.body.data?.permissions?.includes(Permission.ROUTE_ASSIGN)) redirect('/rutas');

  /*
   * Los cobradores activos y, si ejecuta rutas, la propia persona (F15 · P-2: el cobrador independiente es `ACCOUNT_ADMIN`).
   * Un supervisor que no sale a la calle sigue sin aparecer: planificarle la jornada es armar trabajo que nadie va a hacer.
   */
  const collectors = planningTargets(team.body.data ?? [], { userId: me.body.data.userId, permissions: me.body.data.permissions ?? [] });
  if (collectors.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState title={t('noCollectors')} text={t('noCollectorsText')} />
      </>
    );
  }

  /*
   * 🔴 Sin fecha en la URL se propone MAÑANA, salvo que HOY ya haya visitas agendadas sin ruta: esas son compromisos del día y
   * planificar «mañana» las dejaba fuera de la pantalla (quien agenda una visita para hoy abre «Planificar» y no la ve).
   * Y sin cobrador elegido se empieza por quien tiene esas visitas, no por el primero de la lista.
   */
  const todayVisits = searchParams.date
    ? []
    : ((await apiCall<AgendaListItem[]>(`/agenda?date=${today}`, { method: 'GET', auth: true }).catch(() => null))?.body.data ?? []).filter(
        (i) => i.type === 'VISIT' && i.status === 'SCHEDULED' && collectors.some((c) => c.userId === i.assigneeId),
      );
  const day = searchParams.date ?? (todayVisits.length > 0 ? today : shiftDay(today, 1));

  // El primero de la lista si no se eligió a nadie: la pantalla siempre está planificándole a alguien.
  const collectorId =
    collectors.find((c) => c.userId === searchParams.collectorId)?.userId ??
    (todayVisits.length > 0 ? todayVisits[0]!.assigneeId : undefined) ??
    collectors[0]!.userId;
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

  /*
   * 🔴 Una visita agendada puede ser de un crédito que NO está en la lista de mora (al día, o de otro responsable). Sin sus datos no
   * hay ubicación que dibujar ni parada que ordenar: el planificador la mostraba «sin ubicación» o no la mostraba. Se trae cada
   * una por su código (la búsqueda ya entiende el código, y respeta el alcance de quien mira) y se suma a lo elegible.
   */
  const rows = [...available.body.data];
  const known = new Set(rows.map((r) => r.creditId));
  /*
   * 🔴 La mora SIN RESPONSABLE también se ofrece: el filtro por cobrador la deja fuera (no es de nadie), y es justo la que cualquiera
   * puede aprovechar —un crédito en mora al que nadie atiende, cerca de la ruta—. Con los mismos filtros que el resto de la lista.
   */
  const unassignedQuery = availableQuery(params, day);
  unassignedQuery.delete('assigneeId');
  unassignedQuery.set('unassigned', 'true');
  const orphans = await apiCall<MoraCreditListItem[]>(`/mora?${unassignedQuery}`, { method: 'GET', auth: true }).catch(() => null);
  for (const row of orphans?.body.data ?? []) {
    if (!known.has(row.creditId)) {
      rows.push(row);
      known.add(row.creditId);
    }
  }
  const absent = visits.filter((v) => !known.has(v.creditId) && v.creditCode).slice(0, 25);
  const found = await Promise.all(
    absent.map((v) =>
      apiCall<MoraCreditListItem[]>(`/mora?${new URLSearchParams({ todos: 'true', limit: '10', q: v.creditCode! })}`, { method: 'GET', auth: true })
        .then((r) => r.body.data?.find((row) => row.creditId === v.creditId))
        .catch(() => undefined),
    ),
  );
  for (const row of found) if (row) rows.push(row);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <PlanScreen
        day={day}
        today={today}
        collectors={collectors}
        collectorId={collectorId}
        available={rows.map(toAvailable)}
        total={(available.body.meta?.total ?? available.body.data.length) + (rows.length - available.body.data.length)}
        routes={routes.body.data ?? []}
        minStops={minStops(params)}
        filtered={hasPlanFilters(params)}
        categories={(categories.body.data ?? []).map((c) => ({ code: c.code, name: c.name }))}
        visits={visits}
      />
    </>
  );
}
