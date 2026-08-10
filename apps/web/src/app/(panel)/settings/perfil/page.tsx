import { getTranslations } from 'next-intl/server';
import type { MyProfile } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { ProfileForm } from './profile-form';

/** Mi perfil (`GET /users/me/profile`). No pide permiso: es de cada quien. */
export default async function PerfilPage() {
  const t = await getTranslations('profile');
  const { status, body } = await apiCall<MyProfile>('/users/me/profile', { method: 'GET', auth: true });

  if (status !== 200 || !body.data) {
    return <EmptyState title={t('error')} text={body.error?.message} />;
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ProfileForm profile={body.data} />
    </>
  );
}
