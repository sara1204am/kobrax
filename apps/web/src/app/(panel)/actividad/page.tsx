import { getTranslations } from 'next-intl/server';
import type { AccountActivityPage } from '@kobrax/shared';
import { getMe, requirePermission } from '@/lib/authz';
import { apiCall } from '@/lib/bff';
import { Permission } from '@kobrax/shared';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { ActivityFeed } from './activity-feed';

/** Quién cambió qué en la cuenta. Pide `audit:read`: el registro trae IPs y cambios de seguridad. */
export default async function CuentaActividadPage() {
  const blocked = await requirePermission(Permission.AUDIT_READ);
  if (blocked) return blocked;
  const t = await getTranslations('account');
  const tp = await getTranslations('panel.pages.activity');
  // La zona horaria sale de la marca de `/auth/me` (la lee cualquier miembro): el auditor no tiene `account:read`.
  const timezone = (await getMe()).body.data?.account?.timezone ?? null;
  const first = await apiCall<AccountActivityPage>('/accounts/me/activity?limit=30', { method: 'GET', auth: true });

  // Un rol sin `audit:read` no tiene la pestaña; si llegó por URL se le dice que no.
  if (first.status !== 200 || !first.body.data) {
    return <EmptyState title={t('noAccess')} text={first.body.error?.message} />;
  }
  return (
    <>
      <PageHeader title={tp('title')} subtitle={tp('subtitle')} />
      <ActivityFeed initial={first.body.data} timezone={timezone} />
    </>
  );
}
