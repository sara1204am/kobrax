'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/components/permissions';
import { CUENTA_TABS } from '@/lib/cuenta-tabs';
import { useHasUnsaved } from './save-bar';

/**
 * Las pestañas de Cuenta. Son enlaces a rutas (no estado), así que cada una se puede abrir, volver
 * y compartir. Sin permiso no se dibuja; la API valida igual.
 */
export function CuentaTabs() {
  const t = useTranslations('account.tabs');
  const pathname = usePathname();
  const { can } = usePermissions();
  const tSave = useTranslations('account.saveBar');
  const unsaved = useHasUnsaved();
  const tabs = CUENTA_TABS.filter((tab) => can(tab.permission));

  return (
    <nav aria-label={t('label')} className="mb-6 flex gap-1 overflow-x-auto border-b border-k-border">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            // Cambiar de pestaña desmonta el formulario: lo escrito se perdería sin avisar.
            onClick={(e) => {
              if (!active && unsaved && !window.confirm(tSave('leave'))) e.preventDefault();
            }}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-[14px] font-medium ${
              active
                ? 'border-k-purple text-k-navy'
                : 'border-transparent text-k-text-2 hover:text-k-navy'
            }`}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
