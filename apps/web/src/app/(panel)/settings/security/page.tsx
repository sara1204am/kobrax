import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/panel-ui';

const OPTIONS = [
  { href: '/settings/security/password', key: 'password' },
  { href: '/settings/security/mfa', key: 'mfa' },
  { href: '/settings/security/sessions', key: 'sessions' },
] as const;

export default async function SecurityHub() {
  const t = await getTranslations('security');

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="space-y-3">
        {OPTIONS.map((o) => (
          <Link
            key={o.href}
            href={o.href}
            className="flex items-center justify-between rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card transition-all hover:border-k-periwinkle"
          >
            <span>
              <span className="block text-[15px] font-medium text-k-text">{t(`options.${o.key}`)}</span>
              <span className="block text-[13px] text-k-text-2">{t(`options.${o.key}Desc`)}</span>
            </span>
            <span aria-hidden className="text-k-muted">
              ›
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
