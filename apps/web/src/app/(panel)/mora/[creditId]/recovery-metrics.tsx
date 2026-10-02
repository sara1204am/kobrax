import { useLocale, useTranslations } from 'next-intl';
import type { RecoveryMetrics } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';

/** Una cifra con su rótulo y, debajo, el detalle que la explica. */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-1 text-[15px] text-k-text">{value}</dd>
      {hint && <dd className="mt-0.5 text-[12px] text-k-muted">{hint}</dd>}
    </div>
  );
}

/**
 * Qué se hizo para recuperar este crédito y qué se logró, **sobre la mora actual**.
 *
 * 🔴 **Lo que todavía no pasó se dice, no se muestra como 0.** «Primer contacto: 0 días» afirmaría que se lo contactó
 * el primer día; sin contacto, la tarjeta dice «Todavía sin contacto». Un 0 de verdad (el mismo día del inicio) sí
 * se muestra, como «el mismo día».
 *
 * 🔴 **El cumplimiento de promesas sólo cuenta las cerradas**, y sin ninguna cerrada no hay porcentaje (regla de
 * `summarizePromises`). Y «recuperado» es lo que cobró Kobrax: lo confirmado por un canal de la entidad no suma.
 *
 * Si el inicio de la mora es una estimación (un importado sólo trae días), se avisa.
 *
 * `metrics === null` es «no se pudo leer»: la ficha sigue entera.
 */
export function RecoveryMetricsSection({ metrics, currency }: { metrics: RecoveryMetrics | null; currency: string }) {
  const t = useTranslations('panel.cases.ficha.metrics');
  const locale = useLocale();
  const amount = (n: number) => money(n, currency);
  /** El mismo hito contado desde que Kobrax registra la mora, si la mora ya venía de antes. */
  const tracked = (n: number | undefined) => (n === undefined ? undefined : t('inKobrax', { when: n === 0 ? t('sameDay').toLowerCase() : t('afterDays', { n }).toLowerCase() }));
  /** «el mismo día» / «a los 4 días» / el texto de «todavía no». */
  const days = (n: number | undefined, pending: string) => (n === undefined ? pending : n === 0 ? t('sameDay') : t('afterDays', { n }));

  return (
    <Section title={t('title')}>
      {metrics === null ? (
        <p className="text-[13px] text-k-muted">{t('unavailable')}</p>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-k-text-2">
            {metrics.window === 'EPISODE' ? t('sinceEpisode', { date: dayDate(metrics.since, locale) }) : t('sinceAll')}
            {metrics.window === 'EPISODE' && metrics.sinceEstimated && <span title={t('estimatedHint')}> {t('estimated')}</span>}
          </p>

          {/* La mora ya venía de antes de registrarse: los «días hasta…» cuentan desde el inicio, y lo anterior pudo pasar fuera de Kobrax. */}
          {metrics.untrackedDays !== undefined && (
            <p className="mb-3 rounded-lg border border-k-warning/40 bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">
              {t('untracked', { n: metrics.untrackedDays })}
            </p>
          )}

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metric
              label={t('recovered')}
              value={amount(metrics.recoveredAmount)}
              hint={[t('payments', { n: metrics.paymentsCount }), metrics.balanceAtStart !== undefined ? t('ofBalance', { amount: amount(metrics.balanceAtStart) }) : null]
                .filter(Boolean)
                .join(' · ')}
            />
            <Metric
              label={t('activities')}
              value={String(metrics.activities.total)}
              hint={t('breakdown', { calls: metrics.activities.calls, visits: metrics.activities.visits, messages: metrics.activities.messages })}
            />
            <Metric label={t('contacts')} value={String(metrics.contacts)} hint={t('contactsHint', { n: metrics.contacts })} />
            <Metric label={t('firstContact')} value={days(metrics.daysToFirstContact, metrics.window === 'EPISODE' ? t('noContact') : '—')} hint={tracked(metrics.sinceTracking?.daysToFirstContact)} />
            <Metric label={t('firstVisit')} value={days(metrics.daysToFirstVisit, metrics.window === 'EPISODE' ? t('noVisit') : '—')} hint={tracked(metrics.sinceTracking?.daysToFirstVisit)} />
            <Metric label={t('firstPayment')} value={days(metrics.daysToFirstPayment, metrics.window === 'EPISODE' ? t('noPayment') : '—')} hint={tracked(metrics.sinceTracking?.daysToFirstPayment)} />
            <Metric
              label={t('promises')}
              value={metrics.promises.kept + metrics.promises.broken === 0 ? '—' : t('promisesKept', { kept: metrics.promises.kept, closed: metrics.promises.kept + metrics.promises.broken })}
              hint={[
                metrics.promises.complianceRate === undefined ? t('noCompliance') : t('compliance', { pct: Math.round(metrics.promises.complianceRate * 100) }),
                metrics.promises.active > 0 ? t('activePromises', { n: metrics.promises.active }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            {metrics.lastRecoveredDays !== undefined && <Metric label={t('lastRecovered')} value={t('afterDays', { n: metrics.lastRecoveredDays })} />}
            {metrics.window === 'EPISODE' && metrics.recoveredAllTime !== metrics.recoveredAmount && (
              <Metric label={t('recoveredAllTime')} value={amount(metrics.recoveredAllTime)} />
            )}
          </dl>
        </>
      )}
    </Section>
  );
}
