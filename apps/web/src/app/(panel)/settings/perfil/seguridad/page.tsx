import { getTranslations } from 'next-intl/server';
import type { MeInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Section } from '@/components/panel-ui';
import { SecurityOptions } from '@/components/security-options';
import { SessionsList } from '@/components/sessions-list';

/** Cómo entras y desde dónde: contraseña, verificación en dos pasos y sesiones abiertas. */
export default async function SeguridadPage() {
  const [t, me] = await Promise.all([
    getTranslations('security'),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);

  return (
    <>
      <Section title={t('access')} inner="p-4">
        <SecurityOptions mfaEnabled={me.body.data?.mfaEnabled} />
      </Section>
      <Section title={t('sessions.title')} description={t('options.sessionsDesc')} inner="p-4">
        <SessionsList />
      </Section>
    </>
  );
}
