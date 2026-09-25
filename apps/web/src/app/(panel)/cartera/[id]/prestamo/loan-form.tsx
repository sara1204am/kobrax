'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  buildNewCreditPayload,
  creditFormState,
  initialCreditForm,
  memberName,
  type CreditDetail,
  type CreditForm,
  type Member,
} from '@kobrax/shared';
import { PageHeader, Section } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { CreditQuotePanel, CreditTermsFields } from '@/components/credit-terms-fields';
import { PaymentPlanTable } from '@/components/payment-plan-table';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';

/**
 * Hoy en la zona de quien carga, no en UTC: con `toISOString()` Bolivia (UTC−4) proponía la fecha de
 * mañana a partir de las 20:00.
 */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Nuevo crédito (F4/06 · Fase 2): cómo se define, sus condiciones, la cotización en vivo y el plan de
 * pagos **antes** de darlo.
 *
 * 🔴 **Sólo crea.** Ya no hay «este préstamo ya está en curso»: un crédito existente es el detalle de
 * un crédito, no una variante del alta (D13 — el estado al registrar se ajusta desde la ficha).
 *
 * La vista previa y lo que se guarda salen del mismo motor (`creditFormState` / `buildNewCreditPayload`
 * de shared, y `resolveCreditTerms` en la API): lo que se ve es lo que se cobra.
 */
export function LoanForm({
  clientId,
  clientName,
  team,
  currency,
}: {
  clientId: string;
  clientName: string;
  team: Member[];
  currency: string;
}) {
  const t = useTranslations('portfolio');
  const tc = useTranslations('portfolio.creditForm');
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState<CreditForm>(() => initialCreditForm(todayIso()));
  const [manager, setManager] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const state = useMemo(() => creditFormState(form), [form]);
  const schedule = state.missing.length === 0 ? state.calculation.schedule : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildNewCreditPayload(form, clientId);
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

      <section className="rounded-2xl border border-k-border bg-white p-5">
        <CreditTermsFields form={form} onChange={setForm} />
      </section>

      <CreditQuotePanel state={state} currency={currency} />

      {schedule && schedule.length > 0 && (
        <Section title={tc('plan.title')}>
          <p className="mb-3 text-[12px] text-k-muted">{tc('plan.hint')}</p>
          <PaymentPlanTable rows={schedule} currency={currency} />
        </Section>
      )}

      <section className="rounded-2xl border border-k-border bg-white p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {team.length > 0 && (
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
          )}
          <Field label={t('form.notes')}>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />
          </Field>
        </div>
      </section>
    </form>
  );
}
