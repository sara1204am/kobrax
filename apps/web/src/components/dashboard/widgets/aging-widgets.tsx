import { getTranslations } from 'next-intl/server';
import type { AgingBucketRow } from '@kobrax/shared';
import { AGING_COLORS } from '@/lib/dashboard-colors';
import { money } from '@/lib/format';
import { Bars, Donut, Legend, type Slice } from '../charts';

/**
 * Los dos widgets que salen de la MISMA consulta: cuánta plata hay en cada tramo de mora y cuántos
 * créditos son.
 *
 * Viven en un archivo porque comparten los datos y la escala de color; separarlos obligaría a
 * repetir el armado de las porciones en los dos.
 */

async function slicesOf(rows: AgingBucketRow[], currency: string, mode: 'amount' | 'credits'): Promise<Slice[]> {
  const t = await getTranslations('panel.dashboard.buckets');
  return rows.map((r) => ({
    key: r.bucket,
    label: t(r.bucket),
    value: mode === 'amount' ? r.amount : r.credits,
    display: mode === 'amount' ? money(r.amount, currency) : String(r.credits),
    color: AGING_COLORS[r.bucket] ?? '#5B7DBE',
  }));
}

export async function AgingDonut({ rows, currency }: { rows: AgingBucketRow[]; currency: string }) {
  const t = await getTranslations('panel.dashboard');
  const slices = await slicesOf(rows, currency, 'amount');
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0) return <p className="text-[13px] text-k-text-2">{t('noOverdue')}</p>;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Donut slices={slices} center={money(total, currency)} caption={t('widgets.aging')} />
      <Legend slices={slices} />
    </div>
  );
}

export async function AgingBars({ rows }: { rows: AgingBucketRow[] }) {
  const t = await getTranslations('panel.dashboard');
  const slices = await slicesOf(rows, 'BOB', 'credits');

  if (slices.every((s) => s.value === 0)) return <p className="text-[13px] text-k-text-2">{t('noOverdue')}</p>;

  return (
    <>
      <Bars slices={slices} />
      <p className="mt-2 text-[11px] text-k-muted">{t('creditsInBucket')}</p>
    </>
  );
}
