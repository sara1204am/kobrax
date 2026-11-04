import { getLocale, getTranslations } from 'next-intl/server';
import { money, percent } from '@/lib/format';
import type { OfficePortfolio } from '@/lib/offices';

/** Una celda de la banda: rótulo chico arriba, cifra debajo. Los avisos largos van en `title` para no ocupar sitio. */
function Cell({ label, hint, title, tone = 'neutral', children }: { label: string; hint?: string; title?: string; tone?: 'neutral' | 'danger' | 'navy'; children: React.ReactNode }) {
  return (
    <div title={title} className={`px-5 py-3.5 ${tone === 'navy' ? 'bg-k-navy' : ''}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${tone === 'navy' ? 'text-white/70' : 'text-k-slate'}`}>{label}</p>
      <div className={`mt-1 space-y-0.5 text-[20px] font-semibold leading-tight tabular-nums ${tone === 'danger' ? 'text-k-danger' : tone === 'navy' ? 'text-white' : 'text-k-navy'}`}>{children}</div>
      {hint && <p className="mt-0.5 text-[12px] text-k-text-2">{hint}</p>}
    </div>
  );
}

/**
 * La cartera de la oficina, siempre a la vista en la cabecera: créditos asignados, créditos en mora, cartera total y cartera
 * en mora. Incluye lo que cuelga de ella (una regional no tiene créditos propios, los tienen sus agencias).
 *
 * 🔴 La cartera en mora es el **saldo adeudado** de los créditos atrasados, no la cuota. Y se suma por moneda: bolivianos y
 * dólares no se mezclan.
 */
export async function OfficeStats({ portfolio }: { portfolio: OfficePortfolio }) {
  const t = await getTranslations('account.offices.detail.stats');
  const locale = await getLocale();
  const none = portfolio.byCurrency.length === 0;
  const lines = (pick: (c: OfficePortfolio['byCurrency'][number]) => number) =>
    none ? <p>{money(0)}</p> : portfolio.byCurrency.map((c) => <p key={c.currency}>{money(pick(c), c.currency)}</p>);
  const share = portfolio.byCurrency.length === 1 && portfolio.byCurrency[0]!.balance > 0 ? portfolio.byCurrency[0]!.arrearsBalance / portfolio.byCurrency[0]!.balance : null;

  const danger = portfolio.arrearsCredits > 0 ? 'danger' : 'neutral';

  return (
    <section aria-label={t('title')} className="mb-6 overflow-hidden rounded-2xl border border-k-border bg-white">
      <div className="grid grid-cols-2 divide-x divide-k-border lg:grid-cols-4 [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-k-border lg:[&>*:nth-child(n+3)]:border-t-0">
        <Cell label={t('assigned')} tone="navy" title={t('scopeHint')}>
          <p>{portfolio.credits.toLocaleString(locale)}</p>
        </Cell>
        <Cell label={t('arrearsCredits')} tone={danger}>
          <p>{portfolio.arrearsCredits.toLocaleString(locale)}</p>
        </Cell>
        <Cell label={t('portfolio')} tone="navy">{lines((c) => c.balance)}</Cell>
        <Cell label={t('arrearsPortfolio')} tone={danger} title={t('balanceHint')} hint={share === null ? undefined : t('share', { pct: percent(share * 100) })}>
          {lines((c) => c.arrearsBalance)}
        </Cell>
      </div>
    </section>
  );
}
