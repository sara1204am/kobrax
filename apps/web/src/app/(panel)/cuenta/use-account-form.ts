'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrearsMethod, diffAccount, hasChanges, type AccountForm, type AccountInfo } from '@kobrax/shared';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { useSaveSection } from './save-bar';

const formOf = (a: AccountInfo): AccountForm => ({
  businessName: a.businessName,
  taxId: a.taxId ?? '',
  countryCode: a.countryCode,
  currencyCode: a.currencyCode,
  timezone: a.timezone ?? '',
  currencyDecimals: String(a.currencyDecimals ?? 2),
  arrearsMethod: a.arrearsMethod ?? ArrearsMethod.OLDEST_UNPAID,
  logoUrl: a.logoUrl ?? '',
  phone: a.phone ?? '',
  email: a.email ?? '',
  website: a.website ?? '',
  address: a.address ?? '',
  city: a.city ?? '',
});

/**
 * El estado de un formulario de la cuenta.
 *
 * Guarda **sólo lo que cambió** (`diffAccount` de `shared`): la API corre con
 * `forbidNonWhitelisted: true` y reenviar el objeto del `GET` sería un 400. Cada pestaña usa su
 * propia instancia con el mismo `PATCH /accounts/me`; como cada una sólo edita sus campos, el
 * diff de una no pisa a la otra. `sectionId` identifica el formulario ante la barra de guardado.
 */
export function useAccountForm(account: AccountInfo, sectionId: string) {
  const router = useRouter();
  const t = useTranslations('account');
  const toast = useToast();
  const { can } = usePermissions();

  const [initial, setInitial] = useState(() => formOf(account));
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = diffAccount(initial, form);
  const dirty = hasChanges(patch);

  async function save(e?: React.FormEvent): Promise<boolean> {
    e?.preventDefault();
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<AccountInfo>('/api/account/me', patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return false;
    }
    setInitial(form);
    toast(t('saved'));
    // El nombre del negocio también vive en el selector de empresa de la topbar, que lo pintó
    // el servidor: sin refrescar, el panel sigue mostrando el viejo.
    router.refresh();
    return true;
  }

  function reset() {
    setForm(initial);
    setError(null);
  }

  // Dentro de la pestaña, la barra de guardado única guarda por este formulario.
  const { managed } = useSaveSection(sectionId, { dirty, saving, valid: true, save, reset });

  return { form, setForm, error, setError, saving, dirty, save, managed, editable: can('account:write') };
}
