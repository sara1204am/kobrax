'use client';

import { useTranslations } from 'next-intl';
import { LinkTabs } from '@/components/link-tabs';
import { PERFIL_TABS } from '@/lib/perfil-tabs';
import { useHasUnsaved } from '../../cuenta/save-bar';

/**
 * Las pestañas de Mi perfil: enlaces a rutas (no estado), igual que `CuentaTabs`, así que cada
 * una se abre, se recarga y se comparte. Cambiar de pestaña desmonta el formulario: si hay algo
 * sin guardar se pregunta antes.
 */
export function ProfileTabs() {
  const t = useTranslations('profile.tabs');
  const tSave = useTranslations('account.saveBar');
  const unsaved = useHasUnsaved();

  return (
    <LinkTabs
      label={t('label')}
      onNavigate={() => !unsaved || window.confirm(tSave('leave'))}
      tabs={PERFIL_TABS.map((tab) => ({ key: tab.key, href: tab.href, label: t(tab.key) }))}
    />
  );
}
