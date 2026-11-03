import { getTranslations } from 'next-intl/server';
import type { MeInfo, MyProfile } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { isKnownRole } from '@/lib/team';
import { ProfileForm } from '../profile-form';

/** Quién eres: nombre, contacto, foto y el QR con el que te pagan. */
export default async function DatosPersonalesPage() {
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
  return <ProfileForm profile={profile.body.data} roleLabel={role ? (isKnownRole(role) ? tTeam(role) : role) : undefined} />;
}
