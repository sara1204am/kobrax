import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { getAccount } from '../get-account';
import { SupportAccessView, type SupportSessionRow } from './support-access-view';

/** Los accesos de soporte de la plataforma a esta cuenta. Pide `support:consent` (el administrador); sin permiso la API responde 403. */
export default async function CuentaSoportePage() {
  const t = await getTranslations('account');
  const { body: account } = await getAccount();
  const res = await apiCall<SupportSessionRow[]>('/support-access', { method: 'GET', auth: true });
  if (res.status !== 200 || !res.body.data) return <EmptyState title={t('noAccess')} text={res.body.error?.message} />;
  return <SupportAccessView initial={res.body.data} timezone={account.data?.timezone ?? null} />;
}
