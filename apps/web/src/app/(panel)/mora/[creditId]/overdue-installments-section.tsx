import { useLocale, useTranslations } from 'next-intl';
import type { UpdatedPlan } from '@kobrax/shared';
import { Badge, Section } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';

/**
 * Las cuotas vencidas de un crédito, **cada una con sus días de atraso**: la mora se mide por cuota, no sobre el saldo total.
 *
 * No calcula nada: todo viene del plan actualizado (`MoraCreditDetail.plan`, el mismo que Cartera). Lo vencido se parte en capital e interés
 * corriente cuando las cuotas lo traen. **No suma cargos por mora**: hoy el crédito no genera intereses moratorios; se muestra el atraso y lo
 * vencido tal cual, y los cargos moratorios —cuando existan— irán en su propia columna, nunca dentro de la cuota ni del capital.
 *
 * `plan === undefined` = sin plan de cuotas (préstamo abierto, o una operación de una fuente externa): la sección no se dibuja.
 */
export function OverdueInstallmentsSection({ plan, currency }: { plan: UpdatedPlan | undefined; currency: string }) {
  const t = useTranslations('panel.mora.ficha.overdue');
  const locale = useLocale();
  if (!plan) return null;
  const rows = plan.rows.filter((r) => r.status === 'OVERDUE');

  return (
    <Section title={t('title')} anchor="OVERDUE" collapsible={{ count: rows.length, scroll: false }}>
      {rows.length === 0 ? (
        <p className="text-k-sm text-k-muted">{t('none')}</p>
      ) : (
        <>
          <dl className="mb-4 grid gap-x-6 gap-y-3 sm:grid-cols-3" data-testid="overdue-summary">
            <Figure label={t('total')} value={money(plan.overdueAmount, currency)} danger />
            {plan.overduePrincipal !== undefined && <Figure label={t('principal')} value={money(plan.overduePrincipal, currency)} />}
            {plan.overdueInterest !== undefined && <Figure label={t('interest')} value={money(plan.overdueInterest, currency)} />}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-k-base" data-testid="overdue-installments">
              <thead>
                <tr className="border-b border-k-border text-left text-k-xs font-semibold uppercase tracking-wide text-k-text-2">
                  <th scope="col" className="py-2 pr-4">{t('installment')}</th>
                  <th scope="col" className="py-2 pr-4">{t('dueDate')}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{t('days')}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{t('amount')}</th>
                  <th scope="col" className="py-2 pr-4 text-right">{t('paid')}</th>
                  <th scope="col" className="py-2 text-right">{t('pending')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.number} className="border-b border-k-border last:border-0">
                    <td className="py-2 pr-4 text-k-text-2">{r.number}</td>
                    <td className="whitespace-nowrap py-2 pr-4">{dayDate(r.dueDate, locale)}</td>
                    <td className="py-2 pr-4 text-right">
                      <Badge tone="danger">{t('daysValue', { n: r.daysPastDue })}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(r.amount, currency)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(r.paid, currency)}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className="font-semibold text-k-danger">{money(r.pending, currency)}</span>
                      {r.principalPending !== undefined && r.interestPending !== undefined && (
                        <span className="block text-k-xs text-k-muted">
                          {t('split', { principal: money(r.principalPending, currency), interest: money(r.interestPending, currency) })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-k-xs text-k-muted">{t('noCharges')}</p>
    </Section>
  );
}

function Figure({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <dt className="text-k-xs text-k-text-2">{label}</dt>
      <dd className={`mt-0.5 text-k-lg font-semibold tabular-nums ${danger ? 'text-k-danger' : 'text-k-navy'}`}>{value}</dd>
    </div>
  );
}
