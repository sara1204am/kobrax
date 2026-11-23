'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMinimizedNotice } from '@/lib/notice-minimize';
import { TextButton } from '@/components/ui';

/**
 * Aviso de que faltan datos fiscales para poder facturar. Se monta una sola vez en el marco del panel y se
 * apaga en la propia pantalla de Facturación, que ya muestra el detalle.
 */
export function BillingAlert({ missing }: { missing: string[] }) {
  const t = useTranslations('panel.billingAlert');
  const tField = useTranslations('account.billing');
  const pathname = usePathname();
  const [minimized, setMinimized] = useMinimizedNotice('billing');
  if (missing.length === 0 || pathname.startsWith('/cuenta/facturacion')) return null;

  if (minimized) {
    return (
      <TextButton
        onClick={() => setMinimized(false)}
        aria-expanded={false}
        tone="muted"
        className="mb-5 inline-flex items-center gap-2 rounded-full border border-k-warning bg-k-warning-bg px-3 py-1 text-k-xs font-semibold text-k-warning-text hover:opacity-80 !no-underline !text-k-warning-text"
      >
        ⚠ {t('minimizedLabel')} <span aria-hidden>▾</span>
      </TextButton>
    );
  }

  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3 text-k-sm text-k-warning-text">
      <p>
        <span className="font-semibold">{t('title')}</span> {t('text', { fields: missing.map((k) => tField(k)).join(', ') })}
      </p>
      <Link href="/cuenta/facturacion" className="whitespace-nowrap font-semibold text-k-periwinkle hover:underline">
        {t('action')}
      </Link>
      <TextButton onClick={() => setMinimized(true)} tone="muted" className="!text-k-xs !text-k-warning-text">
        {t('minimize')}
      </TextButton>
    </div>
  );
}
