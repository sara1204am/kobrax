import { useLocale, useTranslations } from 'next-intl';
import type { CreditPaymentsView } from '@kobrax/shared';
import { Badge, Section } from '@/components/panel-ui';
import { LateInterestSection } from '@/components/late-interest-section';
import { date, dayDate, money } from '@/lib/format';

/**
 * Los pagos de UN crédito: cada uno con su importe, cuándo se registró y cuándo se cobró, cómo (medio y canal), su estado y A QUÉ
 * CUOTAS se aplicó, con el saldo del plan después de ese movimiento.
 *
 * No calcula nada: la imputación y el saldo posterior vienen de la API (lo persistido en `payment_applications`). Un pago anterior a
 * que existiera esa tabla no tiene reparto guardado y se dice así, en vez de inventarlo.
 */
export function CreditPaymentHistory({ view }: { view: CreditPaymentsView }) {
  const t = useTranslations('portfolio.creditPaymentsPage');
  const tMethod = useTranslations('panel.payments.method');
  const tChannel = useTranslations('panel.payments.channel');
  const locale = useLocale();
  const cur = view.currency;
  const plan = view.plan;

  return (
    <>
      {plan && (
        <dl className="mb-6 grid gap-x-6 gap-y-4 sm:grid-cols-4" data-testid="payments-summary">
          <Figure label={t('paidInKobrax')} value={money(plan.collectedAmount, cur)} />
          {plan.prepaidAmount > 0 && <Figure label={t('beforeKobrax')} value={money(plan.prepaidAmount, cur)} />}
          <Figure label={t('balance')} value={money(plan.balance, cur)} />
          <Figure
            label={plan.overdueAmount > 0 ? t('overdue') : t('nextPayment')}
            value={
              plan.overdueAmount > 0
                ? money(plan.overdueAmount, cur)
                : plan.nextPayment
                  ? `${money(plan.nextPayment.amount, cur)} · ${dayDate(plan.nextPayment.dueDate, locale)}`
                  : '—'
            }
          />
        </dl>
      )}
      {!plan && <p className="mb-4 text-k-sm text-k-muted">{t('noPlan')}</p>}
      {view.lateInterest && (
        <div className="mb-6">
          <LateInterestSection creditId={view.creditId} currency={cur} lateInterest={view.lateInterest} />
        </div>
      )}

      <Section title={t('title')}>
        {view.payments.length === 0 ? (
          <p className="text-k-base text-k-text-2">{t('empty')}</p>
        ) : (
          <ul className="space-y-3">
            {view.payments.map((p) => (
              <li key={p.id} className="rounded-xl border border-k-border bg-white px-4 py-3" data-testid="credit-payment">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-k-md font-semibold tabular-nums text-k-navy">{money(p.amount, cur)}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone="success">{t(`status.${p.status}`)}</Badge>
                    {p.channel === 'EXTERNAL_CONFIRMED' && <Badge tone="neutral">{tChannel('EXTERNAL_CONFIRMED')}</Badge>}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-k-sm text-k-text-2">
                  <span>{tMethod(p.method)}</span>
                  <span>{t('collectedOn', { date: date(p.paymentDate, locale) })}</span>
                  <span>{t('registeredOn', { date: date(p.registeredAt, locale) })}</span>
                  {p.receiptNumber !== undefined && <span>{t('receipt', { n: p.receiptNumber })}</span>}
                </p>
                {p.imputation && (
                  <div className="mt-2 border-t border-k-border pt-2 text-k-sm">
                    {p.imputation.unrecorded ? (
                      <p className="text-k-muted">{t('unrecorded')}</p>
                    ) : (
                      <>
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-k-text-2">{t('appliedTo')}</span>
                          {p.imputation.allocations.map((a) => (
                            <span key={a.installmentNumber} className="rounded-md bg-k-bg px-2 py-0.5 text-k-text">
                              {t(a.coversInstallment ? 'installmentFull' : 'installmentPartial', { n: a.installmentNumber })}{' '}
                              <span className="tabular-nums text-k-text-2">{money(a.amount, cur)}</span>
                            </span>
                          ))}
                        </p>
                        {p.imputation.unapplied > 0 && <p className="mt-1 text-k-warning-text">{t('unapplied', { amount: money(p.imputation.unapplied, cur) })}</p>}
                        <p className="mt-1 text-k-text-2">{t('balanceAfter', { amount: money(p.imputation.balanceAfter, cur) })}</p>
                      </>
                    )}
                  </div>
                )}
                {p.notes && <p className="mt-1 text-k-sm text-k-text">{p.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-k-xs text-k-text-2">{label}</dt>
      <dd className="mt-0.5 text-k-lg font-semibold tabular-nums text-k-navy">{value}</dd>
    </div>
  );
}
