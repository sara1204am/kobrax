'use client';

import { useTranslations } from 'next-intl';
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  OFFERED_FREQUENCIES,
  PaymentFrequency,
  RepaymentForm,
  rateBaseApplies,
  type CreditForm,
  type CreditFormState,
} from '@kobrax/shared';
import { Segmented } from '@/components/panel-ui';
import { Field, Input, Select } from '@/components/ui';
import { money } from '@/lib/format';

/**
 * Las condiciones del crédito (F4/06 · Fase 2): **cómo se define** y, según eso, sólo los campos que
 * hacen falta. Lo financiero avanzado queda plegado en «Opciones avanzadas».
 *
 * 🔴 **Acá no se calcula nada.** El estado (`creditFormState`) y el payload salen de
 * `@kobrax/shared`, con el mismo motor que usa la API para guardar: la cuota que se ve es la que se
 * cobra.
 *
 * Reemplaza a `loan-fields.tsx` en el alta. La ficha del crédito todavía usa aquél; en la Fase 3
 * pasa a éste con modos de lectura y edición, y `loan-fields.tsx` se borra.
 */
export function CreditTermsFields({ form, onChange }: { form: CreditForm; onChange: (next: CreditForm) => void }) {
  const t = useTranslations('portfolio.creditForm');
  const tp = useTranslations('portfolio');
  const set = (patch: Partial<CreditForm>) => onChange({ ...form, ...patch });

  const calculated = form.definition === CreditDefinition.CALCULATED;
  const agreedInstallment = form.definition === CreditDefinition.AGREED_INSTALLMENT;
  const agreedTotal = form.definition === CreditDefinition.AGREED_TOTAL;
  // Un solo pago, sea calculado o acordado: la fecha es "la" fecha, no la primera de varias.
  const single =
    (calculated && form.amortization === AmortizationMethod.SINGLE_PAYMENT) ||
    (agreedTotal && form.repayment === RepaymentForm.SINGLE);

  const numberInput = (value: string, onValue: (v: string) => void, step = '0.01', placeholder?: string) => (
    <Input value={value} onChange={(e) => onValue(e.target.value)} type="number" min={0} step={step} placeholder={placeholder} />
  );

  return (
    <>
      <div className="mb-5 space-y-2">
        <p className="text-[14px] font-medium text-k-text">{t('definitionLabel')}</p>
        <div className="flex flex-wrap">
          <Segmented
            label={t('definitionLabel')}
            value={form.definition}
            onChange={(definition) => set({ definition })}
            options={Object.values(CreditDefinition).map((d) => ({ value: d, label: t(`definition.${d}`) }))}
          />
        </div>
        <p className="text-[12px] text-k-muted">{t(`definitionHint.${form.definition}`)}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('principal')}>{numberInput(form.principal, (principal) => set({ principal }))}</Field>

        {calculated && <Field label={t('ratePercent')}>{numberInput(form.ratePercent, (ratePercent) => set({ ratePercent }))}</Field>}
        {agreedInstallment && (
          <Field label={t('installmentAmount')}>{numberInput(form.installmentAmount, (installmentAmount) => set({ installmentAmount }))}</Field>
        )}
        {agreedTotal && <Field label={t('agreedTotal')}>{numberInput(form.agreedTotal, (agreedTotal) => set({ agreedTotal }))}</Field>}

        {agreedTotal && (
          <div className="space-y-2 sm:col-span-2">
            <p className="text-[14px] font-medium text-k-text">{t('repayment')}</p>
            <div className="flex">
              <Segmented
                label={t('repayment')}
                value={form.repayment}
                onChange={(repayment) => set({ repayment })}
                options={Object.values(RepaymentForm).map((r) => ({ value: r, label: t(`repaymentOptions.${r}`) }))}
              />
            </div>
          </div>
        )}

        {/* Número de cuotas: en el calculado de pago único es el plazo sobre el que corre el interés. */}
        {(calculated || agreedInstallment || (agreedTotal && form.repayment === RepaymentForm.INSTALLMENTS)) && (
          <Field label={calculated && single ? t('term') : t('installmentsCount')}>
            {numberInput(
              form.installmentsCount,
              (installmentsCount) => set({ installmentsCount }),
              '1',
              agreedInstallment ? t('openLoanHint') : undefined,
            )}
          </Field>
        )}

        {!(agreedTotal && single) && (
          <Field label={calculated && single ? t('termFrequency') : t('frequency')}>
            <Select value={form.frequency} onChange={(e) => set({ frequency: e.target.value as PaymentFrequency })}>
              {OFFERED_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {tp(`frequency.${f}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={single ? t('paymentDate') : t('firstDueDate')}>
          <Input type="date" value={form.firstDueDate} onChange={(e) => set({ firstDueDate: e.target.value })} required />
        </Field>
      </div>

      {/* Sólo lo que el dominio soporta hoy (D4, D8). Sin seguro ni cargos: son otra épica. */}
      {calculated && (
        <details className="group mt-5 rounded-xl border border-k-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] font-medium text-k-text hover:bg-k-bg [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-k-muted transition-transform group-open:rotate-180">
              ⌄
            </span>
            {t('advanced')}
          </summary>
          <div className="grid gap-5 border-t border-k-border p-4 sm:grid-cols-2">
            <Field label={t('interestType')}>
              <Select value={form.interestType} onChange={(e) => set({ interestType: e.target.value as InterestType })}>
                {Object.values(InterestType).map((i) => (
                  <option key={i} value={i}>
                    {t(`interestTypes.${i}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('amortization')}>
              <Select value={form.amortization} onChange={(e) => set({ amortization: e.target.value as AmortizationMethod })}>
                {/* Capital fijo no se ofrece todavía: se registra recién con el cronograma real (Fase 6). */}
                {[AmortizationMethod.FIXED_INSTALLMENT, AmortizationMethod.SINGLE_PAYMENT].map((a) => (
                  <option key={a} value={a}>
                    {t(`amortizations.${a}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {rateBaseApplies(form) && (
              <Field label={t('rateBase')}>
                <Select value={form.rateBase} onChange={(e) => set({ rateBase: e.target.value as InterestBase })}>
                  {Object.values(InterestBase).map((b) => (
                    <option key={b} value={b}>
                      {tp(`interestBase.${b}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </details>
      )}
    </>
  );
}

/**
 * Cuota / Total a cobrar / Ganancia, y los avisos del motor. Mientras falten datos no se muestran
 * errores —el usuario todavía no terminó de tipear—, sólo qué falta para ver la cuota.
 */
export function CreditQuotePanel({ state, currency }: { state: CreditFormState; currency: string }) {
  const t = useTranslations('portfolio.creditForm');
  const quote = state.calculation.quote;

  return (
    <section className="rounded-2xl border border-k-border bg-k-highlight p-5" aria-live="polite">
      {state.missing.length > 0 || !quote ? (
        <p className="text-[14px] text-k-text-2">{t('incomplete')}</p>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Quote
              label={quote.installmentVaries ? t('quote.firstInstallment') : t('quote.installment')}
              value={money(quote.installment, currency)}
              big
            />
            <Quote label={t('quote.total')} value={quote.total != null ? money(quote.total, currency) : '—'} />
            <Quote label={t('quote.profit')} value={quote.profit != null ? money(quote.profit, currency) : '—'} />
          </dl>
          {quote.total == null && <p className="mt-3 text-[13px] text-k-text-2">{t('quote.openLoan')}</p>}
        </>
      )}
      {state.issues.map((i) => (
        <p key={i.code} className={`mt-3 text-[13px] ${i.severity === 'error' ? 'text-k-danger' : 'text-k-warning-text'}`}>
          {t(`issues.${i.code}`)}
        </p>
      ))}
    </section>
  );
}

function Quote({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className={`mt-0.5 font-semibold tabular-nums text-k-navy ${big ? 'text-[22px]' : 'text-[16px]'}`}>{value}</dd>
    </div>
  );
}
