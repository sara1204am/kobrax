'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  COUNTRY_CURRENCIES,
  diffAccount,
  hasChanges,
  type AccountForm,
  type AccountInfo,
} from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';

const formOf = (a: AccountInfo): AccountForm => ({
  businessName: a.businessName,
  taxId: a.taxId ?? '',
  countryCode: a.countryCode,
  currencyCode: a.currencyCode,
});

/**
 * Datos del negocio.
 *
 * Guarda **sólo lo que cambió** (`diffAccount` de `shared`): la API corre con
 * `forbidNonWhitelisted: true` y reenviar el objeto del `GET` sería un 400. De paso, el botón
 * está apagado mientras no haya nada que guardar — la regla se ve en pantalla.
 */
export function BusinessForm({ account }: { account: AccountInfo }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('account');
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const [initial, setInitial] = useState(() => formOf(account));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // El nombre del país lo pone el navegador en el idioma activo. `shared` guarda la regla
  // (qué países y con qué moneda), no cómo se escriben.
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return COUNTRY_CURRENCIES.map((c) => ({ ...c, name: names.of(c.code) ?? c.code })).sort((a, b) =>
      a.name.localeCompare(b.name, locale),
    );
  }, [locale]);

  const patch = diffAccount(initial, form);
  const dirty = hasChanges(patch);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<AccountInfo>('/api/account/me', patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    setInitial(form);
    toast(t('saved'));
    // El nombre del negocio también vive en el selector de empresa de la topbar, que lo pintó
    // el servidor: sin refrescar, el panel sigue mostrando el viejo.
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-k-border bg-white p-6">
      <ErrorBanner message={error} />

      <Field label={t('businessName')}>
        <Input
          value={form.businessName}
          onChange={(e) => setForm({ ...form, businessName: e.target.value })}
          disabled={!editable}
          required
          minLength={2}
          maxLength={160}
        />
      </Field>

      <Field label={t('taxId')}>
        <Input
          value={form.taxId}
          onChange={(e) => setForm({ ...form, taxId: e.target.value })}
          disabled={!editable}
          maxLength={40}
          placeholder={t('taxIdPlaceholder')}
        />
      </Field>

      {/*
        País y moneda son UN campo: van acoplados (decisión S1-D1 del móvil) y por eso no se
        pueden combinar mal. `<select>` nativo — no hay dropdown que valga la pena escribir
        para seis opciones.
      */}
      <Field label={t('country')}>
        <Select
          value={form.countryCode}
          onChange={(e) => {
            const picked = countries.find((c) => c.code === e.target.value);
            if (picked) setForm({ ...form, countryCode: picked.code, currencyCode: picked.currency });
          }}
          disabled={!editable}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} · {c.currency} ({c.symbol})
            </option>
          ))}
        </Select>
      </Field>

      {editable && (
        <div className="flex justify-end">
          <span className="w-full sm:w-56">
            <Button type="submit" loading={saving} disabled={!dirty}>
              {t('save')}
            </Button>
          </span>
        </div>
      )}
    </form>
  );
}
