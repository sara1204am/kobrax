import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LegalText } from '@/components/legal-text';
import { apiCall } from '@/lib/bff';
import { date } from '@/lib/format';
import { LEGAL_LOCALE, LEGAL_PAGES, isLegalPage, type LegalDocument, type LegalVersionSummary } from '@/lib/legal';

/** Versión pedida en `?v=`: lista cerrada de caracteres (se arma una ruta hacia la API con ella). */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,30}$/;

/**
 * Página pública y permanente de un documento legal (`/terminos`, `/privacidad`, `/cookies`, `/dpa`, `/uso-aceptable`, `/ia`).
 *
 * Es el **enlace estable** que usan el pie del menú, los correos y quien quiera citar un documento. Sin `?v=` muestra la versión
 * vigente; con `?v=1.0.0`, esa versión exacta: **las versiones anteriores siguen disponibles** (se conservan todas). No requiere
 * sesión: tiene que poder leerse antes de crear la cuenta.
 */
export default async function LegalDocumentPage({
  params,
  searchParams,
}: {
  params: { doc: string };
  searchParams: { v?: string };
}) {
  if (!isLegalPage(params.doc)) notFound();
  const page = LEGAL_PAGES[params.doc];
  const wanted = searchParams.v;
  if (wanted !== undefined && !VERSION.test(wanted)) notFound();

  const t = await getTranslations('legal.document');
  const base = `/legal/documents/${page.slug}`;
  const [docRes, listRes] = await Promise.all([
    apiCall<LegalDocument>(`${base}/${wanted ? `versions/${encodeURIComponent(wanted)}` : 'current'}?locale=${LEGAL_LOCALE}`),
    apiCall<LegalVersionSummary[]>(`${base}/versions?locale=${LEGAL_LOCALE}`),
  ]);
  const doc = docRes.body.data;
  const versions = listRes.body.data ?? [];
  // Una versión concreta que no existe es un 404 real (no una página 200 con un aviso). Sin `?v=` y sin nada publicado todavía,
  // en cambio, se muestra el aviso «aún no está publicado».
  if (wanted !== undefined && !doc) notFound();

  return (
    <div className="min-h-screen bg-k-bg">
      <header className="border-b border-k-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="text-[15px] font-semibold tracking-[0.16em] text-k-navy">
            KOBRAX
          </Link>
          <Link href="/" className="text-[13px] font-medium text-k-purple hover:underline">
            {t('backHome')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="mb-1 text-[26px] font-semibold text-k-navy">{doc?.title ?? t(`names.${page.key}`)}</h1>

        {!doc ? (
          <p role="status" className="mt-4 rounded-xl border border-k-border bg-white px-5 py-4 text-[14px] text-k-text-2">
            {t('notFound')}
          </p>
        ) : (
          <>
            <p className="mb-6 text-[13px] text-k-muted">
              {t('version', { version: doc.version })} · {t('effective', { date: date(doc.effectiveAt) })}
            </p>
            <article className="rounded-2xl border border-k-border bg-white px-6 py-6 shadow-k-card">
              <LegalText content={doc.content} />
            </article>
            <p className="mt-3 break-all font-mono text-[11px] text-k-muted">{t('fingerprint', { hash: doc.contentSha256 })}</p>
          </>
        )}

        {versions.length > 1 && (
          <section className="mt-8">
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-k-muted">{t('history')}</h2>
            <ul className="space-y-1 text-[14px]">
              {versions.map((v, i) => (
                <li key={v.id}>
                  <Link href={i === 0 ? `/${params.doc}` : `/${params.doc}?v=${encodeURIComponent(v.version)}`} className="text-k-purple hover:underline">
                    {t('version', { version: v.version })}
                  </Link>{' '}
                  <span className="text-k-muted">
                    · {date(v.effectiveAt)}
                    {i === 0 ? ` · ${t('current')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <nav aria-label={t('others')} className="mt-8 border-t border-k-border pt-5">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-k-muted">{t('others')}</h2>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
            {Object.entries(LEGAL_PAGES).map(([path, p]) => (
              <li key={path}>
                <Link href={`/${path}`} className={path === params.doc ? 'font-semibold text-k-navy' : 'text-k-purple hover:underline'}>
                  {t(`names.${p.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
