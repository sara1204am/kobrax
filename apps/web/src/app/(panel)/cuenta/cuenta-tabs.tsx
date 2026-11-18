'use client';

import { useTranslations } from 'next-intl';
import { LinkTabs } from '@/components/link-tabs';
import { usePermissions } from '@/components/permissions';
import { CUENTA_TABS } from '@/lib/cuenta-tabs';
import { useHasUnsaved } from './save-bar';

/**
 * Las pestañas de Cuenta. Son enlaces a rutas (no estado), así que cada una se puede abrir, volver
 * y compartir. Sin permiso no se dibuja; la API valida igual.
 */
export function CuentaTabs({ billingPending = false }: { billingPending?: boolean }) {
  const t = useTranslations('account.tabs');
  const tSave = useTranslations('account.saveBar');
  const { can } = usePermissions();
  const unsaved = useHasUnsaved();
  const tabs = CUENTA_TABS.filter((tab) => can(tab.permission));

  return (
    <LinkTabs
      label={t('label')}
      // Cambiar de pestaña desmonta el formulario: lo escrito se perdería sin avisar.
      onNavigate={() => !unsaved || window.confirm(tSave('leave'))}
      tabs={tabs.map((tab) => ({
        key: tab.key,
        href: tab.href,
        label: t(tab.key),
        badge:
          tab.key === 'facturacion' && billingPending ? (
            <span role="img" aria-label={t('billingPending')} className="ml-1.5 inline-block h-2 w-2 rounded-full bg-k-warning align-middle" />
          ) : undefined,
      }))}
    />
  );
}
