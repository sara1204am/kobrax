import { getTranslations } from 'next-intl/server';
import { Permission, todayISO, type MeInfo, type Member, type RouteItem } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { dayOr } from '@/lib/agenda';
import { hasRouteFilters, routeLimit, routeQuery, type RouteParams } from '@/lib/routes';
import { DayPicker } from '@/components/day-picker';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RoutesTable } from './routes-table';

/**
 * Las rutas del día.
 *
 * 🔴 Igual que casos y agenda, **`GET /routes` acota por capacidad y la respuesta no lo dice**: con
 * `ROUTE_ASSIGN` se ven las de todo el equipo, sin ella sólo las propias. La señal la pone la
 * pantalla, porque el contrato no la trae.
 *
 * El día viaja en la URL como en la agenda, y el `DayPicker` es el mismo componente (W6-T2-bis).
 * **El día no es un filtro más**: siempre hay uno, así que se elige arriba y en grande, no adentro
 * del panel del costado con los que se pueden sacar.
 */
export default async function RutasPage({ searchParams }: { searchParams: RouteParams }) {
  const t = await getTranslations('panel.routes');
  const today = todayISO();
  const day = dayOr(today, searchParams.date);

  const [list, me, team] = await Promise.all([
    apiCall<RouteItem[]>(`/routes?${routeQuery({ ...searchParams, date: day })}`, {
      method: 'GET',
      auth: true,
    }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  const members = team.body.data ?? [];
  const supervises = me.body.data?.permissions?.includes(Permission.ROUTE_ASSIGN) ?? false;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {!supervises && (
        <p className="mb-4 rounded-xl border border-k-border bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
          {t('scopedToMine')}
        </p>
      )}

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
  );
}
