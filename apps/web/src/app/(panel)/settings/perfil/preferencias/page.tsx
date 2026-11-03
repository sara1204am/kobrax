import { getTranslations } from 'next-intl/server';
import { Section } from '@/components/panel-ui';
import { LocaleSwitch } from '@/components/locale-switch';
import { AccountPrefsHint } from './account-prefs-hint';

/**
 * Preferencias **personales**: lo que cambia sólo para ti. Las del negocio (jornada, inicio de
 * semana, zona horaria) son de la cuenta y viven en Cuenta → Cobranza; se aclara acá para no
 * confundirlas. Las personales nuevas entran como otra fila de esta sección.
 */
export default async function PreferenciasPage() {
  const t = await getTranslations('profile');

  return (
    <Section title={t('preferences')} description={t('preferencesHint')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="block text-[14px] font-medium text-k-text">{t('language')}</span>
          <span className="block text-[13px] text-k-text-2">{t('languageHint')}</span>
        </span>
        <LocaleSwitch />
      </div>
      <AccountPrefsHint />
    </Section>
  );
}
