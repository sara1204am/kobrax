import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { PageHeader, EmptyState, Badge } from '@/components/panel-ui';
import { CuentaTabs } from './cuenta-tabs';
import { SaveBarProvider } from './save-bar';
import { getAccount } from './get-account';

/** El tono de cada estado de la cuenta. Suspendida es la única que duele: nadie entra. */
const STATUS_TONE = {
  ACTIVE: 'success',
  TRIAL: 'neutral',
  SUSPENDED: 'danger',
  INACTIVE: 'neutral',
  CANCELLED: 'neutral',
} as const;

/**
 * El marco de la cuenta: título, estado y pestañas. Cada pestaña dibuja lo suyo.
 *
 * Requiere `account:read`; la API lo valida.
 */
export default async function CuentaLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('account');
  const { status, body } = await getAccount();

  // 403 = el rol no tiene `account:read`. El ítem del menú tampoco se le dibuja, así que llegar
  // acá es haber escrito la URL: se dice que no y listo, sin sugerir cómo entrar.
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('noAccess')} text={body.error?.message} />;
  }
  const account = body.data;
  const known = account.status in STATUS_TONE;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        badge={
          <Badge dot tone={known ? STATUS_TONE[account.status as keyof typeof STATUS_TONE] : 'neutral'}>
            {known ? t(`status.${account.status}`) : account.status}
          </Badge>
        }
      />
      <SaveBarProvider>
        <CuentaTabs />
        <div className="space-y-6">{children}</div>
      </SaveBarProvider>
    </>
  );
}
