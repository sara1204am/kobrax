import { getTranslations } from 'next-intl/server';
import { PageHeader, Section } from '@/components/panel-ui';

const ITEMS = [
  { href: '/api/exports/clients', key: 'clients' },
  { href: '/api/exports/locations', key: 'locations' },
  { href: '/api/exports/cases', key: 'cases' },
  { href: '/api/exports/agenda', key: 'agenda' },
] as const;

/**
 * Exportar: los CSV de cartera (clientes, ubicaciones, mora, agenda) más el backup completo de
 * la cuenta. Son navegaciones simples a `/api/exports/*` — el BFF adjunta el Bearer y el
 * `Content-Disposition: attachment` del backend hace que el navegador lo baje solo.
 */
export default async function ExportarPage() {
  const t = await getTranslations('exports');

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="space-y-6">
        <Section title={t('dataTitle')}>
          <div className="space-y-3">
            {ITEMS.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card transition-all hover:border-k-periwinkle"
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-k-text">{t(`items.${item.key}`)}</span>
                  <span className="block text-[13px] text-k-text-2">{t(`items.${item.key}Desc`)}</span>
                </span>
                <span aria-hidden className="text-k-muted">
                  ⬇
                </span>
              </a>
            ))}
          </div>
        </Section>

        <Section title={t('backupTitle')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="max-w-md">
              <span className="block text-[14px] font-medium text-k-text">{t('backup')}</span>
              <span className="block text-[13px] text-k-text-2">{t('backupHint')}</span>
            </span>
            <a
              href="/api/exports/backup"
              className="whitespace-nowrap rounded-xl border border-k-border px-4 py-2.5 text-[14px] font-medium text-k-navy hover:bg-k-bg"
            >
              {t('backupAction')}
            </a>
          </div>
        </Section>
      </div>
    </>
  );
}
