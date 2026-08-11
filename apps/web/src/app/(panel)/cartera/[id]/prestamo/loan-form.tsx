'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  InterestBase,
  PaymentFrequency,
  buildPrestamoPayload,
  canSubmitPrestamo,
  currentInstallment,
  initialPrestamo,
  memberName,
  quoteFor,
  totalBelowCapital,
  type CreditDetail,
  type Member,
  type PrestamoForm,
} from '@kobrax/shared';
import { PageHeader } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { money } from '@/lib/format';

const select =
  'h-[52px] w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 text-[15px] text-k-text outline-none transition-all focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-60';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Alta de préstamo, con el panel Cuota / Total / Ganancia en vivo.
 *
 * 🔴 **La cotización no se escribe acá.** `quoteFor`, `currentInstallment` y `canSubmitPrestamo`
 * viven en `@kobrax/shared` y son **las mismas** que usa el teléfono. Es plata: si el escritorio
 * calculara distinto, la diferencia aparecería meses después en la boca de un cliente.
 *
 * Dos modos, como en el móvil: **A** con la cuota tipeada (el cobrador ya la sabe) y **B**
 * calculándola desde el interés. En B la cuota sigue siendo editable, para redondearla — y al
 * editarla, el cálculo deja de pisarla.
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
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState<PrestamoForm>(() => initialPrestamo(todayIso()));
  const [manager, setManager] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<PrestamoForm>) => setForm({ ...form, ...patch });
  const quote = quoteFor(form);
  const valid = canSubmitPrestamo(form);
  const warn = totalBelowCapital(form);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const { ok, data } = await postJson<CreditDetail>('/api/credits', {
      ...buildPrestamoPayload(form, clientId),
      // En la oficina, quien carga el préstamo y quien lo cobra no son la misma persona.
      ...(manager ? { assignedManagerId: manager } : {}),
    });
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    toast(t('loanCreated'));
    router.push(`/cartera/${clientId}/credito/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <PageHeader
        title={t('loanTitle')}
        subtitle={t('loanSubtitle', { name: clientName })}
        actions={
          <>
            <span className="w-32">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                {t('cancel')}
              </Button>
            </span>
            <span className="w-44">
              <Button type="submit" loading={saving} disabled={!valid}>
                {t('loanSave')}
              </Button>
            </span>
          </>
        }
      />

      <ErrorBanner message={error} />

      <section className="rounded-2xl border border-k-border bg-white p-5">
        {/* El modo no es una preferencia: cambia de dónde sale la cuota. */}
        <div className="mb-5 flex gap-2">
          {(['A', 'B'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set({ mode: m })}
              aria-pressed={form.mode === m}
              className={`rounded-xl px-4 py-2 text-[14px] font-medium ${
                form.mode === m ? 'bg-k-navy text-white' : 'border border-k-border bg-white text-k-text-2 hover:bg-k-bg'
              }`}
            >
              {t(`loanMode.${m}`)}
            </button>
          ))}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('fields.principal')}>
            <Input value={form.principal} onChange={(e) => set({ principal: e.target.value })} inputMode="decimal" required />
          </Field>

          {form.mode === 'B' && (
            <>
              <Field label={t('form.interest')}>
                <Input value={form.interestPercent} onChange={(e) => set({ interestPercent: e.target.value })} inputMode="decimal" />
              </Field>
              <Field label={t('form.interestBase')}>
                <select value={form.base} onChange={(e) => set({ base: e.target.value as InterestBase })} className={select}>
                  <option value={InterestBase.PER_PERIOD}>{t('interestBase.PER_PERIOD')}</option>
                  <option value={InterestBase.TOTAL}>{t('interestBase.TOTAL')}</option>
                </select>
              </Field>
            </>
          )}

          <Field label={t('fields.installment')}>
            <Input
              value={form.mode === 'B' && !form.installmentEdited ? String(currentInstallment(form) || '') : form.installment}
              // Editarla a mano en el modo B la congela: el cálculo deja de pisarla. Es para
              // redondear a un número que se pueda cobrar en billetes.
              onChange={(e) => set({ installment: e.target.value, installmentEdited: form.mode === 'B' })}
              inputMode="decimal"
            />
          </Field>

          <Field label={t('form.installmentsCount')}>
            <Input
              value={form.installmentsCount}
              onChange={(e) => set({ installmentsCount: e.target.value })}
              inputMode="numeric"
              placeholder={t('form.openLoanHint')}
            />
          </Field>

          <Field label={t('fields.frequency')}>
            <select value={form.frequency} onChange={(e) => set({ frequency: e.target.value as PaymentFrequency })} className={select}>
              {Object.values(PaymentFrequency).map((f) => (
                <option key={f} value={f}>
                  {t(`frequency.${f}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('fields.nextDue')}>
            <Input type="date" value={form.nextDueDate} onChange={(e) => set({ nextDueDate: e.target.value })} />
          </Field>

          {team.length > 0 && (
            <Field label={t('form.assignedTo')}>
              <select value={manager} onChange={(e) => setManager(e.target.value)} className={select}>
                <option value="">{t('form.unassigned')}</option>
                {team.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      {/* El panel en vivo. Sale de `shared`: los mismos tres números que muestra el teléfono. */}
      <section className="rounded-2xl border border-k-border bg-k-highlight p-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Quote label={t('quote.installment')} value={money(quote.installment, currency)} big />
          <Quote label={t('quote.total')} value={money(quote.total, currency)} />
          <Quote label={t('quote.profit')} value={money(quote.profit, currency)} />
        </dl>
        {/* Aviso, no freno: hay préstamos que se dan así, y el cobrador sabrá. */}
        {warn && <p className="mt-3 text-[13px] text-k-warning-text">{t('quote.belowCapital')}</p>}
      </section>

      <section className="rounded-2xl border border-k-border bg-white p-5">
        <label className="flex items-center gap-2 text-[14px] text-k-text">
          <input
            type="checkbox"
            checked={form.inProgress}
            onChange={(e) => set({ inProgress: e.target.checked })}
            className="h-4 w-4 accent-k-purple"
          />
          {t('form.inProgress')}
        </label>
        <p className="mt-1 text-[12px] text-k-muted">{t('form.inProgressHint')}</p>

        {form.inProgress && (
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label={t('form.outstanding')}>
              <Input value={form.outstandingBalance} onChange={(e) => set({ outstandingBalance: e.target.value })} inputMode="decimal" required />
            </Field>
            <Field label={t('form.daysPastDue')}>
              <Input value={form.daysPastDue} onChange={(e) => set({ daysPastDue: e.target.value })} inputMode="numeric" />
            </Field>
          </div>
        )}

        <div className="mt-5">
          <Field label={t('form.notes')}>
            <Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={500} />
          </Field>
        </div>
      </section>
    </form>
  );
}

function Quote({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className={`mt-0.5 font-semibold text-k-navy ${big ? 'text-[22px]' : 'text-[16px]'}`}>{value}</dd>
    </div>
  );
}
