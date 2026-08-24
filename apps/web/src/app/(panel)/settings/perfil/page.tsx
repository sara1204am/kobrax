import { getTranslations } from 'next-intl/server';
import type { MeInfo, MyProfile } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Badge, EmptyState, PageHeader, Section } from '@/components/panel-ui';
import { LocaleSwitch } from '@/components/locale-switch';
import { SecurityOptions } from '@/components/security-options';
import { isKnownRole } from '@/lib/team';
import { ProfileForm } from './profile-form';

/**
 * Mi perfil: todo «lo mío» en una pantalla, como el hub de Cuenta del móvil — los datos, las
 * preferencias y la seguridad. No pide permiso: es de cada quien.
 *
 * `/auth/me` se pide otra vez sólo por el rol y el estado del MFA, que el perfil no trae.
 */
export default async function PerfilPage() {
  const [t, tTeam, profile, me] = await Promise.all([
    getTranslations('profile'),
    getTranslations('team.roles'),
    apiCall<MyProfile>('/users/me/profile', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);

  if (profile.status !== 200 || !profile.body.data) {
    return <EmptyState title={t('error')} text={profile.body.error?.message} />;
  }
  const role = me.body.data?.role;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        badge={role && <Badge>{isKnownRole(role) ? tTeam(role) : role}</Badge>}
      />
      <div className="space-y-6">
        <ProfileForm profile={profile.body.data} />

        <Section title={t('preferences')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <span className="block text-[14px] font-medium text-k-text">{t('language')}</span>
              <span className="block text-[13px] text-k-text-2">{t('languageHint')}</span>
            </span>
            <LocaleSwitch />
          </div>
        </Section>

        <Section title={t('security')} inner="">
          <SecurityOptions mfaEnabled={me.body.data?.mfaEnabled} />
        </Section>
      </div>
    </>
  );
}
