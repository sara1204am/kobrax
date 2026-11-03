import { getLocale, getTranslations } from 'next-intl/server';
import type { PlanHistoryEntry } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { dateTime } from '@/lib/format';

const PLANS = new Set(['FREE', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']);
const STATUSES = new Set(['ACTIVE', 'TRIAL', 'SUSPENDED', 'INACTIVE', 'CANCELLED']);

/**
 * Los cambios de plan y de estado que hizo Kobrax en esta cuenta. Sólo lectura: la cuenta no cambia su plan sola, lo
 * pide (ver la pestaña Plan) y Kobrax lo hace por consola.
 */
export async function PlanHistory({ entries, timezone }: { entries: PlanHistoryEntry[]; timezone: string | null }) {
  const t = await getTranslations('account.billing');
  const tp = await getTranslations('plans');
  const ta = await getTranslations('account');
  const locale = await getLocale();

  const plan = (code: string | null) => (code && PLANS.has(code) ? tp(`names.${code}`) : (code ?? '—'));
  const status = (code: string | null) => (code && STATUSES.has(code) ? ta(`status.${code}`) : (code ?? '—'));

  return (
    <Section title={t('historyTitle')} inner="p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('historyIntro')}</p>
      {entries.length === 0 ? (
        <p className="mt-4 text-[13px] text-k-text-2">{t('historyEmpty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-k-border rounded-xl border border-k-border">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[14px]">
              <span className="text-k-text">
                {e.fromPlan !== e.toPlan && e.toPlan && (
                  <>
                    {t('planChanged', { from: plan(e.fromPlan), to: plan(e.toPlan) })}
                    {e.fromStatus !== e.toStatus && ' · '}
                  </>
                )}
                {e.fromStatus !== e.toStatus && e.toStatus && t('statusChanged', { from: status(e.fromStatus), to: status(e.toStatus) })}
              </span>
              <time dateTime={e.at} className="text-[12px] text-k-text-2">
                {dateTime(e.at, locale, timezone ?? undefined)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
