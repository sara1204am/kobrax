import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AccountInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { PageHeader, EmptyState, Badge, Section } from '@/components/panel-ui';
import { BusinessForm } from './business-form';
import { PlanCard } from './plan-card';

/** El tono de cada estado de la cuenta. Suspendida es la única que duele: nadie entra. */
const STATUS_TONE = {
  ACTIVE: 'success',
  TRIAL: 'neutral',
  SUSPENDED: 'danger',
  INACTIVE: 'neutral',
  CANCELLED: 'neutral',
} as const;

/**
 * La cuenta: **qué plan tiene y quién es el negocio**, en ese orden.
 *
 * El plan va primero porque es lo que cambia lo que se puede hacer —cuánta gente, cuánta cartera—;
 * los datos del negocio se editan una vez y no se miran más. Antes esta pantalla era sólo el
 * formulario, con los asientos escondidos en una etiqueta del encabezado que además repetía la del
 * equipo.
 *
 * Requiere `account:read`; la API lo valida.
 */
export default async function CuentaPage() {
  const t = await getTranslations('account');
  const { status, body } = await apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true });

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
      <div className="space-y-6">
        <PlanCard account={account} />
        <Section title={t('businessData')} inner="p-6">
          <BusinessForm account={account} />
          {/*
            Lo personal —foto, teléfono, QR de cobro— vive en Mi perfil, no acá: es de la
            persona, no del negocio. Sin este puente, quien busca su QR abre Cuenta y no lo
            encuentra (pasó en la validación del 24/08).
          */}
          <p className="mt-5 border-t border-k-border pt-4 text-[13px] text-k-text-2">
            {t('profileHint')}{' '}
            <Link href="/settings/perfil" className="font-medium text-k-purple hover:underline">
              {t('profileLink')}
            </Link>
          </p>
        </Section>
      </div>
    </>
  );
}
