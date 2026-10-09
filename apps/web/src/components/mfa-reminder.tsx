import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * Recordatorio de verificación en dos pasos pendiente (W-LOG-51).
 *
 * «Lo hago después» deja entrar sin MFA y sin límite de veces (decisión de producto 2026-07-31):
 * el recordatorio es blando y vive en el cliente, a partir del `mfaEnabled` de `GET /auth/me`.
 * Lleva a `/settings/security`, donde ya está la activación. Mismo aviso que el Home del móvil.
 */
export function MfaReminder() {
  const t = useTranslations('panel.dashboard.mfaReminder');
  return (
    <Link
      href="/settings/security"
      className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text hover:opacity-90"
    >
      <span className="rounded-full bg-k-warning px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
        {t('badge')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t('title')}</span>
        <span className="block">{t('text')}</span>
      </span>
      <span className="font-medium underline">{t('cta')}</span>
    </Link>
  );
}
