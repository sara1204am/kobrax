import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { MeInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Badge, PageHeader } from '@/components/panel-ui';
import { isKnownRole } from '@/lib/team';
import { SaveBarProvider } from '../../cuenta/save-bar';
import { ProfileTabs } from './profile-tabs';

/**
 * El marco de Mi perfil: título, rol y pestañas. Cada pestaña dibuja lo suyo. No pide permiso:
 * es de cada quien.
 */
export default async function PerfilLayout({ children }: { children: ReactNode }) {
  const [t, tTeam, me] = await Promise.all([
    getTranslations('profile'),
    getTranslations('team.roles'),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);
  const role = me.body.data?.role;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        badge={role && <Badge>{isKnownRole(role) ? tTeam(role) : role}</Badge>}
      />
      <SaveBarProvider>
        <ProfileTabs />
        <div className="space-y-6">{children}</div>
      </SaveBarProvider>
    </>
  );
}
