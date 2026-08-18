import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Permission, RoleType, todayISO, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { shiftDay } from '@/lib/agenda';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { PlanForm } from './plan-form';

/**
 * Planificar las rutas de un día.
 *
 * 🔴 **Es una pantalla propia, no un modal.** Se eligen personas, se revisa lo que va a pasar y
 * recién ahí se publica: tres pasos con datos que se cargan en el medio no entran en una caja
 * flotante, y el mismo camino ya existe así para pedir un cobro y para dar de alta un préstamo.
 *
 * 🔴 **Abre en MAÑANA, no en hoy.** Planificar es preparar el trabajo que viene; la jornada de hoy
 * ya está en la calle. Se puede cambiar la fecha, pero el default es el caso normal.
 */
export default async function PlanificarPage() {
  const t = await getTranslations('panel.routes.planning');

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

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {collectors.length === 0 ? (
        <EmptyState title={t('noCollectors')} text={t('noCollectorsText')} />
      ) : (
        <PlanForm collectors={collectors} defaultDate={shiftDay(todayISO(), 1)} />
      )}
    </>
  );
}
