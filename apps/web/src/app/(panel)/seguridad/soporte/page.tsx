import { Permission } from '@kobrax/shared';
import { getTranslations } from 'next-intl/server';
import { getMe, requirePermission } from '@/lib/authz';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { SupportAccessView, type SupportSessionRow } from './support-access-view';

/** Los accesos de soporte de la plataforma a esta cuenta. Pide `support:consent` (el administrador); sin permiso la API responde 403. */
export default async function CuentaSoportePage() {
  const blocked = await requirePermission(Permission.SUPPORT_CONSENT);
  if (blocked) return blocked;
  const t = await getTranslations('account');
  const tp = await getTranslations('panel.pages.support');
  const timezone = (await getMe()).body.data?.account?.timezone ?? null;
  const res = await apiCall<SupportSessionRow[]>('/support-access', { method: 'GET', auth: true });
  if (res.status !== 200 || !res.body.data) return <EmptyState title={t('noAccess')} text={res.body.error?.message} />;
  return (
    <>
      <PageHeader title={tp('title')} subtitle={tp('subtitle')} />
      <SupportAccessView initial={res.body.data} timezone={timezone} />
    </>
  );
}
