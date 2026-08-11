'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/components/permissions';

/**
 * Dar de alta.
 *
 * Es un `<a>` y no un botón con `router.push`: es una navegación, así que se abre en otra pestaña,
 * se copia el enlace y el navegador la trata como lo que es. Cliente sólo por `usePermissions`.
 *
 * 🔴 Esconderlo es cosmética: quien escriba la URL igual llega, y ahí lo frena la API.
 */
export function NewClientButton() {
  const t = useTranslations('portfolio');
  const { can } = usePermissions();
  if (!can('client:write')) return null;

  return (
    <Link
      href="/cartera/nuevo"
      className="flex h-12 items-center justify-center rounded-xl bg-k-navy px-5 text-[15px] font-semibold text-white transition-all hover:bg-k-slate active:scale-[.98]"
    >
      {t('new')}
    </Link>
  );
}
