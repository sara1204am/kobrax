import { getLocale, getTranslations } from 'next-intl/server';
import { money, percent } from '@/lib/format';
import type { OfficePortfolio } from '@/lib/offices';

function Card({ label, hint, tone = 'neutral', children }: { label: string; hint?: string; tone?: 'neutral' | 'danger'; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-k-border bg-white px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</p>
      <div className={`mt-1.5 space-y-0.5 text-[24px] font-semibold tabular-nums ${tone === 'danger' ? 'text-k-danger' : 'text-k-navy'}`}>{children}</div>
      {hint && <p className="mt-1 text-[12px] text-k-text-2">{hint}</p>}
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

  return (
    <section aria-label={t('title')} className="mb-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label={t('assigned')} hint={t('scopeHint')}>
          <p>{portfolio.credits.toLocaleString(locale)}</p>
        </Card>
        <Card label={t('arrearsCredits')} tone={portfolio.arrearsCredits > 0 ? 'danger' : 'neutral'}>
          <p>{portfolio.arrearsCredits.toLocaleString(locale)}</p>
        </Card>
        <Card label={t('portfolio')}>{lines((c) => c.balance)}</Card>
        <Card label={t('arrearsPortfolio')} tone={portfolio.arrearsCredits > 0 ? 'danger' : 'neutral'} hint={share === null ? t('balanceHint') : `${t('share', { pct: percent(share * 100) })} · ${t('balanceHint')}`}>
          {lines((c) => c.arrearsBalance)}
        </Card>
      </div>
    </section>
  );
}
