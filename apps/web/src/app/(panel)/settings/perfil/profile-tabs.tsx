'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const pathname = usePathname();
  const unsaved = useHasUnsaved();

  return (
    <nav aria-label={t('label')} className="mb-6 flex gap-1 overflow-x-auto border-b border-k-border">
      {PERFIL_TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              if (!active && unsaved && !window.confirm(tSave('leave'))) e.preventDefault();
            }}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-[14px] font-medium ${
              active
                ? 'border-k-periwinkle font-semibold text-k-periwinkle'
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
