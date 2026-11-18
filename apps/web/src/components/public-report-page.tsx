import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PublicReportForm } from '@/components/public-report-form';

/** Página pública (sin sesión) de reportes y de eliminación de cuenta: misma carcasa que las páginas legales. */
export async function PublicReportPage({ mode }: { mode: 'report' | 'deletion' }) {
  const t = await getTranslations('report');
  const tl = await getTranslations('legal.document');
  const deletion = mode === 'deletion';
  return (
    <div className="min-h-screen bg-k-bg">
      <header className="border-b border-k-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="text-k-md font-semibold tracking-[0.16em] text-k-navy">
            KOBRAX
          </Link>
          <Link href="/" className="text-k-sm font-medium text-k-purple hover:underline">
            {tl('backHome')}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-5 py-8">
        <h1 className="mb-2 text-k-4xl font-semibold text-k-navy">{deletion ? t('deletionTitle') : t('title')}</h1>
        <p className="mb-6 text-k-base text-k-text-2">{deletion ? t('deletionIntro') : t('intro')}</p>
        <PublicReportForm mode={mode} />
        <p className="mt-6 text-k-sm text-k-muted">
          {deletion ? (
            <Link href="/reportar" className="text-k-purple hover:underline">
              {t('goReport')}
            </Link>
          ) : (
            <Link href="/eliminar-cuenta" className="text-k-purple hover:underline">
              {t('goDeletion')}
            </Link>
          )}{' '}
          ·{' '}
          <Link href="/privacidad" className="text-k-purple hover:underline">
            {t('privacyLink')}
          </Link>
        </p>
      </main>
    </div>
  );
}
