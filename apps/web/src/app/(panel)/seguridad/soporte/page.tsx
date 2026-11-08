import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { requirePermission } from '@/lib/authz';
import { Permission } from '@kobrax/shared';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { getAccount } from '../../cuenta/get-account';
import { SupportAccessView, type SupportSessionRow } from './support-access-view';

/** Los accesos de soporte de la plataforma a esta cuenta. Pide `support:consent` (el administrador); sin permiso la API responde 403. */
export default async function CuentaSoportePage() {
  const blocked = await requirePermission(Permission.SUPPORT_CONSENT);
  if (blocked) return blocked;
  const t = await getTranslations('account');
  const tp = await getTranslations('panel.pages.support');
  const { body: account } = await getAccount();
  const res = await apiCall<SupportSessionRow[]>('/support-access', { method: 'GET', auth: true });
  if (res.status !== 200 || !res.body.data) return <EmptyState title={t('noAccess')} text={res.body.error?.message} />;
  return (
    <>
      <PageHeader title={tp('title')} subtitle={tp('subtitle')} />
      <SupportAccessView initial={res.body.data} timezone={account.data?.timezone ?? null} />
    </>
  );
}
