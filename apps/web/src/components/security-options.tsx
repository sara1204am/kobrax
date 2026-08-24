import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from './panel-ui';

const OPTIONS = [
  { href: '/settings/security/password', key: 'password' },
  { href: '/settings/security/mfa', key: 'mfa' },
  { href: '/settings/security/sessions', key: 'sessions' },
] as const;

/**
 * Las tres tarjetas de Seguridad. Las pinta el hub `/settings/security` y también Mi perfil,
 * que las agrupa con el resto de «lo mío» como hace el móvil.
 *
 * `mfaEnabled` es el recordatorio blando que el móvil da en el Home: si no está activa, la tarjeta
 * lo dice en ámbar en vez de esperar a que alguien entre a mirar.
 */
export function SecurityOptions({ mfaEnabled }: { mfaEnabled?: boolean }) {
  const t = useTranslations('security.options');

  return (
    <div className="space-y-3">
      {OPTIONS.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className="flex items-center justify-between gap-3 rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card transition-all hover:border-k-periwinkle"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-medium text-k-text">{t(o.key)}</span>
              {o.key === 'mfa' && mfaEnabled !== undefined && (
                <Badge tone={mfaEnabled ? 'success' : 'warning'} dot>
                  {mfaEnabled ? t('mfaOn') : t('mfaOff')}
                </Badge>
              )}
            </span>
            <span className="block text-[13px] text-k-text-2">
              {o.key === 'mfa' && mfaEnabled === false ? t('mfaOffHint') : t(`${o.key}Desc`)}
            </span>
          </span>
          <span aria-hidden className="text-k-muted">
            ›
          </span>
        </Link>
      ))}
    </div>
  );
}
