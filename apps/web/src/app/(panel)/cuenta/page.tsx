import { getTranslations } from 'next-intl/server';
import type { AccountInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { PageHeader, EmptyState, Badge } from '@/components/panel-ui';
import { BusinessForm } from './business-form';

/** Datos del negocio (`GET /accounts/me`). Requiere `account:read`; la API lo valida. */
export default async function CuentaPage() {
  const t = await getTranslations('account');
  const { status, body } = await apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true });

  // 403 = el rol no tiene `account:read`. El ítem del menú tampoco se le dibuja, así que llegar
  // acá es haber escrito la URL: se dice que no y listo, sin sugerir cómo entrar.
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('noAccess')} text={body.error?.message} />;
  }
  const account = body.data;
  const full = account.memberCount >= account.maxUsers;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Badge tone={full ? 'warning' : 'neutral'}>
            {t('seats', { used: account.memberCount, max: account.maxUsers })}
          </Badge>
        }
      />
      <BusinessForm account={account} />
    </>
  );
}
