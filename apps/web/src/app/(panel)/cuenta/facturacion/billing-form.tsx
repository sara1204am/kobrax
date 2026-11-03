'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BILLING_FIELDS, BILLING_MAX, EMPTY_BILLING, hasChanges, type AccountBilling, type AccountInfo } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { useSaveSection } from '../save-bar';

type Form = Record<keyof AccountBilling, string>;

const formOf = (b: AccountBilling): Form => ({
  legalName: b.legalName ?? '',
  taxId: b.taxId ?? '',
  address: b.address ?? '',
  email: b.email ?? '',
});

/** Sólo lo que cambió; vaciar un dato lo QUITA (`null`): un `''` chocaría con el `@Length(1, n)` de la API. */
function diffBilling(before: Form, after: Form): Partial<Record<keyof AccountBilling, string | null>> {
  const out: Partial<Record<keyof AccountBilling, string | null>> = {};
  for (const key of BILLING_FIELDS) {
    const now = after[key].trim();
    if (now === before[key].trim()) continue;
    out[key] = now === '' ? null : now;
  }
  return out;
}

/**
 * Datos de facturación: a nombre de quién y adónde se manda la factura. Sin cobro dentro del producto —el plan lo
 * gestiona Kobrax—, son los datos que Kobrax usa para emitirla. Se integra a la barra de guardado de la pestaña.
 */
export function BillingForm({ account }: { account: AccountInfo }) {
  const t = useTranslations('account.billing');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canEdit = can('account:write');
  // Lo guardado se ve en modo vista; «Editar» lo habilita y Cancelar/Guardar lo cierran (igual que General).
  const [editing, setEditing] = useState(false);
  const editable = canEdit && editing;

  const [initial, setInitial] = useState<Form>(() => formOf(account.billing ?? EMPTY_BILLING));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Lo obligatorio que falta según lo ya guardado (no lo que se está escribiendo): el aviso se va al guardar.
  const missing = account.billingMissing ?? [];

  const patch = diffBilling(initial, form);
  const dirty = hasChanges(patch);

  async function save(e?: React.FormEvent): Promise<boolean> {
    e?.preventDefault();
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson('/api/account/me', { billing: patch }, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return false;
    }
    setInitial(form);
    setEditing(false);
    toast(t('saved'));
    router.refresh();
    return true;
  }

  useSaveSection('billing', {
    dirty,
    saving,
    valid: true,
    inline: true,
    save,
    reset: () => {
      setForm(initial);
      setError(null);
    },
  });

  return (
    <form onSubmit={save} className="space-y-6">
      <ErrorBanner message={error} />
      {missing.length > 0 && (
        <div role="alert" className="rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
          <span className="font-semibold">{t('missingTitle')}</span> {t('missingText', { fields: missing.map((k) => t(k)).join(', ') })}
        </div>
      )}
      <Section title={t('title')} inner="space-y-5 p-6">
        <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>
        <Field label={t('legalName')} hint={t('legalNameHint')}>
          <Input value={form.legalName} maxLength={BILLING_MAX.legalName} disabled={!editable} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('taxId')}>
            <Input value={form.taxId} maxLength={BILLING_MAX.taxId} disabled={!editable} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
          </Field>
          <Field label={t('email')} hint={t('emailHint')}>
            <Input type="email" value={form.email} maxLength={BILLING_MAX.email} disabled={!editable} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
        <Field label={t('address')}>
          <Input value={form.address} maxLength={BILLING_MAX.address} disabled={!editable} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
      </Section>

      {canEdit && (
        <div className="flex justify-end gap-3 border-t border-k-border pt-5">
          {editing ? (
            <>
              <span className="w-full sm:w-36">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setForm(initial);
                    setError(null);
                    setEditing(false);
                  }}
                >
                  {t('cancel')}
                </Button>
              </span>
              <span className="w-full sm:w-48">
                <Button type="submit" loading={saving} disabled={!dirty}>
                  {t('save')}
                </Button>
              </span>
            </>
          ) : (
            <span className="w-full sm:w-48">
              <Button type="button" onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            </span>
          )}
        </div>
      )}
    </form>
  );
}
