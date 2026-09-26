'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  CREDIT_STATUSES,
  memberName,
  type CreditDetail,
  type CreditFormState,
  type Member,
  type RegisteredStateResult,
  type TermsEditBlock,
} from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Section } from '@/components/panel-ui';
import { Field, Input, Select } from '@/components/ui';
import { CreditQuotePanel, CreditTermsFields } from '@/components/credit-terms-fields';
import { PaymentPlanTable } from '@/components/payment-plan-table';
import { dayDate, money } from '@/lib/format';
import type { CreditDraft } from '@/lib/credit-patch';

/**
 * La ficha del crédito en modo edición (F4/06 · Fase 3).
 *
 * 🔴 **Las condiciones son las del alta, con los mismos campos** (`CreditTermsFields`): editar un
 * crédito es volver a definirlo, y la API lo recalcula con el mismo motor. Sólo se ofrecen mientras
 * se pueden guardar (`block === null`); si no, se dice por qué en vez de dibujar campos que la API
 * va a rechazar.
 *
 * El estado al registrar (D13) muestra antes de guardar el saldo y el próximo cobro que van a quedar:
 * sale de `registeredState`, la misma regla que aplica la API.
 */
export function CreditEditor({
  credit,
  draft,
  onChange,
  block,
  state,
  registered,
  team,
  types,
}: {
  credit: CreditDetail;
  draft: CreditDraft;
  onChange: (next: CreditDraft) => void;
  block: TermsEditBlock;
  state: CreditFormState;
  /** El resultado de condiciones + estado al registrar; `null` mientras falten datos. */
  registered: RegisteredStateResult | null;
  team: Member[];
  types: CatalogOption[];
}) {
  const t = useTranslations('portfolio.creditDetail');
  const tp = useTranslations('portfolio');
  const tc = useTranslations('portfolio.creditForm');
  const locale = useLocale();
  const cur = credit.currency;
  const setExtra = (p: Partial<CreditDraft['extras']>) =>
    onChange({ ...draft, extras: { ...draft.extras, ...p } });
  const setInitial = (p: Partial<CreditDraft['initial']>) =>
    onChange({ ...draft, initial: { ...draft.initial, ...p } });

  const schedule = state.missing.length === 0 ? state.calculation.schedule : null;
  const derivedTotal = state.missing.length === 0 ? state.calculation.quote?.total : null;

  return (
    <>
      {block === null ? (
        // Como en el alta: los datos en 3/4 y la cuota en 1/4, fija mientras se baja.
        <div className="grid gap-4 lg:grid-cols-4 lg:items-start">
          <section
            className="rounded-2xl border border-k-border bg-white p-5 lg:col-span-3"
            aria-label={t('sections.terms')}
          >
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
              {t('sections.terms')}
            </h2>
            <CreditTermsFields
              form={draft.form}
              onChange={(form) => onChange({ ...draft, form })}
            />
          </section>

          <aside className="lg:sticky lg:top-4 lg:col-start-4 lg:row-span-3 lg:row-start-1">
            <CreditQuotePanel state={state} currency={cur} />
          </aside>

          {schedule && schedule.length > 0 && (
            <div className="lg:col-span-3">
              <Section title={t('sections.plan')}>
                <PaymentPlanTable rows={schedule} currency={cur} />
              </Section>
            </div>
          )}

          <div className="lg:col-span-3">
            <Section title={t('sections.initialState')}>
              <p className="mb-4 text-[13px] text-k-text-2">{t('initial.hint')}</p>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field label={t('initial.paidInstallments')}>
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    placeholder="0"
                    value={draft.initial.paidInstallments}
                    onChange={(e) => setInitial({ paidInstallments: e.target.value })}
                  />
                </Field>
                <Field label={t('initial.outstandingBalance')}>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    // Vacío = que se derive del plan; el placeholder muestra cuánto daría.
                    placeholder={
                      registered?.ok && registered.balanceDerived
                        ? t('initial.outstandingPlaceholder', {
                            amount: money(registered.outstandingBalance, cur),
                          })
                        : undefined
                    }
                    value={draft.initial.outstandingBalance}
                    onChange={(e) => setInitial({ outstandingBalance: e.target.value })}
                  />
                </Field>
                <Field label={t('initial.daysPastDue')}>
                  <Input
                    type="number"
                    min={0}
                    max={3650}
                    step="1"
                    placeholder="0"
                    value={draft.initial.daysPastDue}
                    onChange={(e) => setInitial({ daysPastDue: e.target.value })}
                  />
                </Field>
              </div>
              <p className="mt-4 text-[13px]" aria-live="polite">
                {registered === null ? (
                  <span className="text-k-text-2">{t('initial.issues.TERMS_INVALID')}</span>
                ) : registered.ok ? (
                  <span className="text-k-text">
                    {t('initial.result', {
                      balance: money(registered.outstandingBalance, cur),
                      date: dayDate(registered.nextDueDate, locale),
                    })}
                  </span>
                ) : (
                  <span className="text-k-danger">{t(`initial.issues.${registered.code}`)}</span>
                )}
              </p>
              {derivedTotal == null && state.missing.length === 0 && (
                <p className="mt-2 text-[12px] text-k-muted">{tc('quote.openLoan')}</p>
              )}
            </Section>
          </div>
        </div>
      ) : (
        <Section title={t('sections.terms')}>
          <p className="text-[14px] text-k-text-2">{t(`blocked.${block}`)}</p>
        </Section>
      )}

      <Section title={t('sections.collection')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={tp('form.status')}>
            <Select
              value={draft.extras.status}
              onChange={(e) => setExtra({ status: e.target.value })}
            >
              {CREDIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tp(`creditStatus.${s}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tp('fields.code')}>
            <Input
              value={draft.extras.code}
              onChange={(e) => setExtra({ code: e.target.value })}
              maxLength={64}
            />
          </Field>

          {types.length > 0 && (
            <Field label={tp('fields.creditType')}>
              <Select
                value={draft.extras.typeCode}
                onChange={(e) => setExtra({ typeCode: e.target.value })}
              >
                <option value="">{tp('creditNoType')}</option>
                {types.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label || c.code}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {team.length > 0 && (
            <Field label={tp('form.assignedTo')}>
              <Select
                value={draft.extras.assignedManagerId}
                onChange={(e) => setExtra({ assignedManagerId: e.target.value })}
              >
                <option value="">{tp('form.unassigned')}</option>
                {team.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {/* Con pagos (o cronograma guardado) las condiciones quedan quietas, pero el próximo cobro
              se puede mover: es la agenda, no el contrato. Sin pagos lo deriva el estado al registrar. */}
          {(block === 'payments' || block === 'schedule') && (
            <Field label={t('nextDue')}>
              <Input
                type="date"
                value={draft.extras.nextDueDate}
                onChange={(e) => setExtra({ nextDueDate: e.target.value })}
              />
            </Field>
          )}

          {/* La nota del importado también la manda la fuente (la API la rechaza con CREDIT_LOCKED). */}
          <div className="sm:col-span-2">
            <Field label={t('notes')}>
              <Input
                value={draft.form.notes}
                onChange={(e) =>
                  onChange({ ...draft, form: { ...draft.form, notes: e.target.value } })
                }
                disabled={block === 'locked'}
                maxLength={500}
              />
            </Field>
          </div>
        </div>
      </Section>
    </>
  );
}
