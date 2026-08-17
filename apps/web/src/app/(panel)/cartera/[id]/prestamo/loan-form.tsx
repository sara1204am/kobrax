'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  buildPrestamoPayload,
  canSubmitPrestamo,
  initialPrestamo,
  memberName,
  type CreditDetail,
  type Member,
  type PrestamoForm,
} from '@kobrax/shared';
import { PageHeader } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { LoanFields, LoanQuotePanel } from '@/components/loan-fields';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Alta de préstamo, con el panel Cuota / Total / Ganancia en vivo.
 *
 * 🔴 **Los campos son los MISMOS que corrigen el préstamo desde su ficha** (`loan-fields.tsx`). Las
 * dos pantallas se habían separado: acá se preguntaba capital, interés y modo, y allá el capital y
 * la tasa se dibujaban de sólo lectura. Dar de alta y corregir tienen que verse igual, porque son
 * lo mismo con el préstamo ya creado.
 *
 * Lo que sí es del alta y no de la ficha vive acá: a quién se asigna, «ya está en curso» (para
 * digitalizar cartera vieja) y la nota inicial.
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
  const valid = canSubmitPrestamo(form);

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
        {/* Los mismos campos que corrigen el préstamo desde su ficha (`components/loan-fields`). */}
        <LoanFields form={form} onChange={setForm} />

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
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
        </div>
      </section>

      <LoanQuotePanel form={form} currency={currency} />

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
            {/* Números de verdad: como texto, `7.000,50` se convertía en NaN y viajaba un cero. */}
            <Field label={t('form.outstanding')}>
              <Input
                value={form.outstandingBalance}
                onChange={(e) => set({ outstandingBalance: e.target.value })}
                type="number"
                min={0}
                step="0.01"
                required
              />
            </Field>
            <Field label={t('form.daysPastDue')}>
              <Input value={form.daysPastDue} onChange={(e) => set({ daysPastDue: e.target.value })} type="number" min={0} step="1" />
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
