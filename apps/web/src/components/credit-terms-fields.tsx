'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  OFFERED_FREQUENCIES,
  PaymentFrequency,
  RateConvention,
  RatePeriod,
  RepaymentForm,
  CHARGE_KINDS,
  TermUnit,
  periodicRatePercent,
  rateBaseApplies,
  ratePeriodApplies,
  termInstallments,
  type ChargeKind,
  type CreditForm,
  type CreditFormCharge,
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
 * Lo usan el alta y la edición de la ficha (Fase 3): editar un crédito es volver a definirlo con
 * los mismos campos.
 */
export function CreditTermsFields({ form, onChange }: { form: CreditForm; onChange: (next: CreditForm) => void }) {
  const t = useTranslations('portfolio.creditForm');
  const tp = useTranslations('portfolio');
  const locale = useLocale();
  const set = (patch: Partial<CreditForm>) => onChange({ ...form, ...patch });

  const calculated = form.definition === CreditDefinition.CALCULATED;
  const agreedInstallment = form.definition === CreditDefinition.AGREED_INSTALLMENT;
  const agreedTotal = form.definition === CreditDefinition.AGREED_TOTAL;
  // Un solo pago, sea calculado o acordado: la fecha es "la" fecha, no la primera de varias.
  const single =
    (calculated && form.amortization === AmortizationMethod.SINGLE_PAYMENT) ||
    (agreedTotal && form.repayment === RepaymentForm.SINGLE);

  // D17: la tasa de cada cuota cuando el % es de otro período, y las cuotas cuando el plazo es en meses/años.
  const periodic = periodicRatePercent({ ...form, ratePercent: Number(form.ratePercent) });
  const rateHint =
    calculated && form.ratePeriod !== RatePeriod.PER_INSTALLMENT && form.ratePercent.trim() !== '' && Number.isFinite(periodic)
      ? t('rateEquivalent', { rate: periodic.toLocaleString(locale, { maximumFractionDigits: 4 }), frequency: tp(`frequency.${form.frequency}`).toLowerCase() })
      : undefined;
  const installments = termInstallments(form.installmentsCount, form.termUnit, form.frequency);
  const termHint =
    form.termUnit !== TermUnit.INSTALLMENTS && form.installmentsCount.trim() !== '' && Number.isFinite(installments)
      ? t('termEquivalent', { count: installments })
      : undefined;

  // Calcular cuotas ofrece cuota fija o variable. Pago único sólo si el crédito ya lo tiene (no se pierde al editar).
  const amortizations = [AmortizationMethod.FIXED_INSTALLMENT, AmortizationMethod.FIXED_PRINCIPAL, ...(form.amortization === AmortizationMethod.SINGLE_PAYMENT ? [AmortizationMethod.SINGLE_PAYMENT] : [])];
  // En Calcular cuotas el período se dice en meses o años; «cuotas» sólo si uno guardado no da meses enteros.
  const termUnits = calculated
    ? [TermUnit.YEARS, TermUnit.MONTHS, ...(form.termUnit === TermUnit.INSTALLMENTS ? [TermUnit.INSTALLMENTS] : [])]
    : Object.values(TermUnit);

  const setCharge = (id: string, p: Partial<CreditFormCharge>) =>
    set({ charges: form.charges.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const addCharge = () =>
    set({ charges: [...form.charges, { id: `n${Date.now()}`, label: '', kind: 'first_amount', value: '' }] });

  // Cuota variable = capital fijo: el interés corre sobre el saldo y es simple (compuesto no se ofrece, D4).
  const setAmortization = (amortization: AmortizationMethod) =>
    set({ amortization, ...(amortization === AmortizationMethod.FIXED_PRINCIPAL ? { interestType: InterestType.SIMPLE } : {}) });

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

        {calculated && (
          <Field label={t('ratePercent')} hint={rateHint}>
            {/* D17: el % y a qué período se refiere van juntos; la frecuencia de pago es otra cosa. */}
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">{numberInput(form.ratePercent, (ratePercent) => set({ ratePercent }))}</div>
              {ratePeriodApplies(form) && (
                <div className="w-40">
                  <Select aria-label={t('ratePeriod')} value={form.ratePeriod} onChange={(e) => set({ ratePeriod: e.target.value as RatePeriod })}>
                    {Object.values(RatePeriod).map((p) => (
                      <option key={p} value={p}>
                        {t(`ratePeriods.${p}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          </Field>
        )}
        {agreedInstallment && (
          <Field label={t('installmentAmount')}>{numberInput(form.installmentAmount, (installmentAmount) => set({ installmentAmount }))}</Field>
        )}
        {agreedTotal && <Field label={t('agreedTotal')}>{numberInput(form.agreedTotal, (agreedTotal) => set({ agreedTotal }))}</Field>}

        {/* Tipo de cuota, a la vista: fija, variable (capital fijo, baja en cada pago) o pago único. */}
        {calculated && (
          <div className="space-y-2 sm:col-span-2">
            <p className="text-[14px] font-medium text-k-text">{t('amortization')}</p>
            <div className="flex flex-wrap">
              <Segmented
                label={t('amortization')}
                value={form.amortization}
                onChange={setAmortization}
                options={amortizations.map((a) => ({ value: a, label: t(`amortizations.${a}`) }))}
              />
            </div>
            <p className="text-[12px] text-k-muted">{t(`amortizationHints.${form.amortization}`)}</p>
          </div>
        )}

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
          <Field label={calculated && single ? t('term') : t('installmentsCount')} hint={termHint}>
            {/* D17: el plazo se puede decir como lo dice el banco («3 años») y se guarda en cuotas. */}
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                {numberInput(
                  form.installmentsCount,
                  (installmentsCount) => set({ installmentsCount }),
                  form.termUnit === TermUnit.INSTALLMENTS ? '1' : '0.5',
                  agreedInstallment ? t('openLoanHint') : undefined,
                )}
              </div>
              <div className="w-32">
                <Select aria-label={t('termUnit')} value={form.termUnit} onChange={(e) => set({ termUnit: e.target.value as TermUnit })}>
                  {termUnits.map((u) => (
                    <option key={u} value={u}>
                      {t(`termUnits.${u}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
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
            {/* Con cuota variable el interés es siempre simple: compuesto daría lo mismo (D4). */}
            {form.amortization !== AmortizationMethod.FIXED_PRINCIPAL && (
              <Field label={t('interestType')}>
                <Select value={form.interestType} onChange={(e) => set({ interestType: e.target.value as InterestType })}>
                  {Object.values(InterestType).map((i) => (
                    <option key={i} value={i}>
                      {t(`interestTypes.${i}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {ratePeriodApplies(form) && form.ratePeriod !== RatePeriod.PER_INSTALLMENT && (
              <Field label={t('rateConvention')}>
                <Select value={form.rateConvention} onChange={(e) => set({ rateConvention: e.target.value as RateConvention })}>
                  {Object.values(RateConvention).map((c) => (
                    <option key={c} value={c}>
                      {t(`rateConventions.${c}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
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

            {/* D18: desgravamen, % mensual sobre el saldo; baja con él. */}
            <Field label={t('insurance')} hint={t('insuranceHint')}>
              {numberInput(form.insuranceMonthlyPercent, (insuranceMonthlyPercent) => set({ insuranceMonthlyPercent }), '0.001', '0')}
            </Field>

            {/* D18: otros cargos — por cuota, en la primera cuota o descontados del desembolso. */}
            <div className="space-y-3 sm:col-span-2">
              <p className="text-[14px] font-medium text-k-text">⚙ {t('charges')}</p>
              {form.charges.map((c) => (
                <div key={c.id} className="grid gap-2 sm:grid-cols-[1fr_14rem_8rem_auto] sm:items-center">
                  <Input
                    aria-label={t('chargeLabel')}
                    placeholder={t('chargeLabelPlaceholder')}
                    value={c.label}
                    maxLength={80}
                    onChange={(e) => setCharge(c.id, { label: e.target.value })}
                  />
                  <Select aria-label={t('chargeKind')} value={c.kind} onChange={(e) => setCharge(c.id, { kind: e.target.value as ChargeKind })}>
                    {CHARGE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`chargeKinds.${k}`)}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={t('chargeValue')}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={c.kind.endsWith('percent') ? '%' : '0'}
                    value={c.value}
                    onChange={(e) => setCharge(c.id, { value: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => set({ charges: form.charges.filter((x) => x.id !== c.id) })}
                    className="text-[13px] font-medium text-k-danger hover:underline"
                  >
                    {t('chargeRemove')}
                  </button>
                </div>
              ))}
              <button type="button" onClick={addCharge} className="text-[13px] font-medium text-k-periwinkle hover:underline">
                + {t('chargeAdd')}
              </button>
            </div>
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
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <Quote
              label={quote.installmentVaries ? t('quote.firstInstallment') : t('quote.installment')}
              value={money(quote.installment, currency)}
              big
            />
            <Quote label={t('quote.total')} value={quote.total != null ? money(quote.total, currency) : '—'} />
            <Quote label={t('quote.profit')} value={quote.profit != null ? money(quote.profit, currency) : '—'} />
          </dl>
          {/* D18: lo que no es ganancia pero sí se cobra, y lo que recibe el cliente si hay descuentos. */}
          {quote.extras && (
            <dl className="mt-4 space-y-1 border-t border-k-border pt-3 text-[13px]">
              {quote.extras.insuranceTotal > 0 && <Extra label={t('quote.insurance')} value={money(quote.extras.insuranceTotal, currency)} />}
              {quote.extras.chargesTotal > 0 && <Extra label={t('quote.charges')} value={money(quote.extras.chargesTotal, currency)} />}
              {quote.extras.deducted > 0 && (
                <>
                  <Extra label={t('quote.deducted')} value={money(quote.extras.deducted, currency)} />
                  <Extra label={t('quote.netDisbursement')} value={money(quote.extras.netDisbursement, currency)} strong />
                </>
              )}
            </dl>
          )}
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

function Extra({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-k-text-2">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-k-navy' : 'text-k-text'}`}>{value}</dd>
    </div>
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
