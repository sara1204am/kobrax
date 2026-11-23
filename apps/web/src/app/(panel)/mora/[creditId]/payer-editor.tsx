'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PAYER_PARTIES } from '@kobrax/shared';
import { useToast } from '@/components/toast';
import { Select, TextButton } from '@/components/ui';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * «Quién responde por el crédito», en el card de la ficha y editable ahí mismo.
 *
 * Es un dato **del crédito** (a quién hay que ir a buscar), no de una gestión: antes se preguntaba en cada «Registrar gestión» y
 * quedaba enterrado en la bitácora. Acá se ve siempre y se cambia con el lápiz, sin abrir un diálogo.
 */
export function PayerEditor({ creditId, value, canWrite }: { creditId: string; value?: string; canWrite: boolean }) {
  const t = useTranslations('panel.mora.detail');
  const tp = useTranslations('panel.mora.ficha.activity.payers');
  const tm = useTranslations('panel.mora');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/mora/${creditId}/payer`, { payerParty: draft || null }, 'PATCH');
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, tm, locale) || t('payerError'));
      return;
    }
    setEditing(false);
    toast(t('payerSaved'));
    router.refresh();
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
        <Select value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} aria-label={t('payerLabel')} className="!h-10 !w-full !text-k-sm sm:!w-80">
          <option value="">{t('payerUnset')}</option>
          {PAYER_PARTIES.map((p) => (
            <option key={p} value={p}>
              {tp(p)}
            </option>
          ))}
        </Select>
        <div className="flex gap-3 text-k-sm">
          <TextButton onClick={() => void save()} disabled={busy} tone="periwinkle">
            {t('payerSave')}
          </TextButton>
          <TextButton
            onClick={() => {
              setEditing(false);
              setDraft(value ?? '');
              setError(null);
            }}
            disabled={busy}
            tone="muted"
          >
            {t('payerCancel')}
          </TextButton>
        </div>
        </div>
        {error && (
          <p role="alert" className="text-k-xs font-normal text-k-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <span className="flex items-center gap-3">
      <span>{value ? tp(value as never) : '—'}</span>
      {canWrite && (
        <TextButton
          onClick={() => {
            setDraft(value ?? '');
            setEditing(true);
          }}
          tone="periwinkle"
          aria-label={`${t('payerEdit')}: ${t('payerLabel')}`}
        >
          {t('payerEdit')}
        </TextButton>
      )}
    </span>
  );
}
