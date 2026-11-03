'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/components/permissions';

/** Aclara que la jornada y el horario son del negocio; sólo enlaza a quien puede abrir esa pestaña. */
export function AccountPrefsHint() {
  const t = useTranslations('profile');
  const { can } = usePermissions();
  return (
    <p className="mt-5 border-t border-k-border pt-4 text-[13px] text-k-text-2">
      {t('accountPrefsHint')}{' '}
      {can('account:read') && (
        <Link href="/cuenta/cobranza" className="font-medium text-k-purple hover:underline">
          {t('accountPrefsLink')}
        </Link>
      )}
    </p>
  );
}
