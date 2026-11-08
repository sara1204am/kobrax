import { getTranslations } from 'next-intl/server';
import { Permission, type RoleSummary } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getMe, requirePermission } from '@/lib/authz';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RetryState } from '@/components/retry-state';
import { RolesTable } from './roles-table';

/**
 * Roles y permisos (vista A del plan de F14 · F7): los roles de la cuenta, su origen, si difieren de la plantilla, cuánta gente los tiene y
 * qué alcance dan. Leer pide `role:read`; editar se hace desde el detalle y exige `role:write` (la API valida los dos).
 */
export default async function RolesPage() {
  const blocked = await requirePermission(Permission.ROLE_READ);
  if (blocked) return blocked;
  const t = await getTranslations('roles');
  const [res, me] = await Promise.all([apiCall<RoleSummary[]>('/roles?assignable=false', { method: 'GET', auth: true }), getMe()]);

  if (res.status === 0 || res.status >= 500) return <RetryState title={t('errors.generic')} />;
  if (res.status !== 200 || !res.body.data) return <EmptyState title={t('empty')} text={res.body.error?.message} />;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <RolesTable roles={res.body.data} timezone={me.body.data?.account?.timezone ?? null} userId={me.body.data?.userId} />
      <p className="mt-3 text-[12px] text-k-muted">{t('legend')}</p>
    </>
  );
}
