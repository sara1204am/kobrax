import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { PageHeader, Badge } from '@/components/panel-ui';
import { CuentaTabs } from './cuenta-tabs';
import { SaveBarProvider } from './save-bar';
import { getAccount } from './get-account';
import { requirePermission } from '@/lib/authz';
import { CUENTA_TABS } from '@/lib/cuenta-tabs';

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
  // F14 · F6 (R-10): el marco ya no exige `account:read` —eso bloqueaba hasta las pestañas que piden otro permiso—;
  // pide poder abrir ALGUNA pestaña, y cada pestaña se protege con la suya.
  const blocked = await requirePermission({ anyOf: CUENTA_TABS.map((tab) => tab.permission) });
  if (blocked) return blocked;
  const t = await getTranslations('account');
  const { status, body } = await getAccount();
  // Sin `account:read` no hay estado que mostrar: se pinta el marco sin la etiqueta.
  const account = status === 200 ? body.data : null;
  const known = account ? account.status in STATUS_TONE : false;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        badge={
          account ? (
            <Badge dot tone={known ? STATUS_TONE[account.status as keyof typeof STATUS_TONE] : 'neutral'}>
              {known ? t(`status.${account.status}`) : account.status}
            </Badge>
          ) : undefined
        }
      />
      <SaveBarProvider>
        <CuentaTabs billingPending={(account?.billingMissing ?? []).length > 0} />
        <div className="space-y-6">{children}</div>
      </SaveBarProvider>
    </>
  );
}
