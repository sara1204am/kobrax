'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  buildNewCreditPayload,
  creditFormState,
  DEFAULT_ARREARS_METHOD,
  initialCreditForm,
  memberName,
  registrationSituation,
  type ArrearsMethod,
  type CreditDetail,
  type CreditForm,
  type Member,
} from '@kobrax/shared';
import { PageHeader, Section } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { CreditQuotePanel, CreditTermsFields } from '@/components/credit-terms-fields';
import { PaymentPlanTable } from '@/components/payment-plan-table';
import { PaidInstallmentsSelect } from '@/components/paid-installments-select';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { todayIso } from '@/lib/format';

/**
 * Nuevo crédito (F4/06 · Fase 2): cómo se define, sus condiciones, la cotización en vivo y el plan de
 * pagos **antes** de darlo.
 *
 * **Cuotas ya pagadas (D13):** un crédito que ya venía corriendo fuera de Kobrax se registra acá mismo,
 * marcando en el plan cuántas de las primeras cuotas ya se pagaron (siempre las primeras, sin huecos).
 * Viaja como `initialState` en el mismo alta, como en el móvil. El panel muestra cómo queda: saldo,
 * próxima cuota y mora (D20), con el método que tenga elegido la cuenta.
 *
 * La vista previa y lo que se guarda salen del mismo motor (`creditFormState` / `buildNewCreditPayload`
 * de shared, y `resolveCreditTerms` + `registeredState` en la API): lo que se ve es lo que se cobra.
 */
export function LoanForm({
  clientId,
  clientName,
  team,
  currency,
  defaultArrearsMethod,
}: {
  clientId: string;
  clientName: string;
  team: Member[];
  currency: string;
  /** El método de mora por defecto de la cuenta (D20). */
  defaultArrearsMethod?: ArrearsMethod;
}) {
  const t = useTranslations('portfolio');
  const tc = useTranslations('portfolio.creditForm');
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState<CreditForm>(() => ({
    ...initialCreditForm(todayIso()),
    arrearsMethod: defaultArrearsMethod ?? DEFAULT_ARREARS_METHOD,
  }));
  /** Cuántas de las primeras cuotas ya estaban pagadas al registrarlo. 0 = crédito nuevo. */
  const [paid, setPaid] = useState(0);
  const [manager, setManager] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const state = useMemo(() => creditFormState(form), [form]);
  const schedule = state.missing.length === 0 ? state.calculation.schedule : null;
  // Si el plan se achica (menos cuotas), el corte no puede quedar en o más allá de la última.
  const paidCount = schedule ? Math.min(paid, Math.max(0, schedule.length - 1)) : 0;
  const situation = useMemo(
    () =>
      schedule && state.calculation.ok
        ? registrationSituation(state.terms, paidCount, form.arrearsMethod, new Date())
        : null,
    [schedule, state, paidCount, form.arrearsMethod],
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildNewCreditPayload(
      form,
      clientId,
      paidCount > 0 ? { paidInstallments: paidCount, daysPastDue: 0 } : undefined,
    );
    if (!payload) return;
    setError(null);
    setSaving(true);

    const { ok, data } = await postJson<CreditDetail>('/api/credits', {
      ...payload,
      // En la oficina, quien carga el crédito y quien lo cobra no son la misma persona.
      ...(manager ? { assignedManagerId: manager } : {}),
    });
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    toast(tc('created'));
    router.push(`/cartera/${clientId}/credito/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <PageHeader
        title={tc('title')}
        subtitle={tc('subtitle', { name: clientName })}
        actions={
          <>
            <span className="w-32">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                {t('cancel')}
              </Button>
            </span>
            <span className="w-44">
              <Button type="submit" loading={saving} disabled={!state.canSubmit}>
                {tc('save')}
              </Button>
            </span>
          </>
        }
      />

      <ErrorBanner message={error} />

      {/* En pantalla ancha: los datos en 3/4 y la cuota en 1/4, fija mientras se baja. En angosta se
          apila, con la cuota justo después de los datos. */}
      <div className="grid gap-4 lg:grid-cols-4 lg:items-start">
        <section className="rounded-2xl border border-k-border bg-white p-5 lg:col-span-3">
          {/* «Lo cobra» y «Notas»: el componente decide dónde van según cómo se define el crédito. */}
          <CreditTermsFields
            form={form}
            onChange={setForm}
            assignee={
              team.length > 0 ? (
                <Field label={t('form.assignedTo')}>
                  <Select value={manager} onChange={(e) => setManager(e.target.value)}>
                    <option value="">{t('form.unassigned')}</option>
                    {team.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {memberName(m)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : undefined
            }
            notes={
              <Field label={t('form.notes')}>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  maxLength={500}
                />
              </Field>
            }
          />
        </section>

        <aside className="lg:sticky lg:top-4 lg:col-start-4 lg:row-span-3 lg:row-start-1">
          <CreditQuotePanel
            state={state}
            currency={currency}
            clientName={clientName}
            situation={situation}
          />
        </aside>

        {schedule && schedule.length > 0 && (
          <div className="lg:col-span-3">
            <Section title={tc('plan.title')}>
              <p className="mb-3 text-[12px] text-k-muted">{tc('plan.hint')}</p>
              {/* D13: el atajo para un crédito que ya venía corriendo. No cambia el número de cuotas. */}
              {schedule.length > 1 && (
                <div className="mb-4 max-w-md">
                  <PaidInstallmentsSelect schedule={schedule} value={paidCount} onChange={setPaid} />
                </div>
              )}
              <PaymentPlanTable
                rows={schedule}
                currency={currency}
                paidCount={paidCount}
                onPaidChange={schedule.length > 1 ? setPaid : undefined}
              />
            </Section>
          </div>
        )}
      </div>
    </form>
  );
}
