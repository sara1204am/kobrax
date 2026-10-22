import { getTranslations } from 'next-intl/server';
import type { AccountActivityPage } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { getAccount } from '../get-account';
import { ActivityFeed } from './activity-feed';

/** Quién cambió qué en la cuenta. Pide `audit:read`: el registro trae IPs y cambios de seguridad. */
export default async function CuentaActividadPage() {
  const t = await getTranslations('account');
  const { body: account } = await getAccount();
  const first = await apiCall<AccountActivityPage>('/accounts/me/activity?limit=30', { method: 'GET', auth: true });

  // Un rol sin `audit:read` no tiene la pestaña; si llegó por URL se le dice que no.
  if (first.status !== 200 || !first.body.data) {
    return <EmptyState title={t('noAccess')} text={first.body.error?.message} />;
  }
  return <ActivityFeed initial={first.body.data} timezone={account.data?.timezone ?? null} />;
}
