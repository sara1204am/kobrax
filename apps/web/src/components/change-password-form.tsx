'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { allPassed, PasswordChecklist } from '@/components/password-checklist';
import { postJson } from '@/lib/client';

/**
 * El formulario de cambio de contraseña, para vivir dentro del `Modal` de Seguridad.
 * Extraído de la antigua página `/settings/security/password`.
 */
export function ChangePasswordForm() {
  const t = useTranslations('security');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !!current && allPassed(next) && next === confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson('/api/account/change-password', {
      currentPassword: current,
      newPassword: next,
    });
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? t('changePassword.error'));
      return;
    }
    // El backend revocó todas las sesiones → el BFF limpió las cookies. Redirige al login.
    setDone(true);
    setTimeout(() => {
      window.location.href = '/login';
    }, 1800);
  }

  if (done) {
    return (
      <div>
        <p className="text-[15px] font-medium text-k-text">{t('changePassword.doneTitle')}</p>
        <p className="mt-2 text-[13px] text-k-text-2">{t('changePassword.doneText')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <ErrorBanner message={error} />
      <Field label={t('changePassword.current')}>
        <Input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </Field>
      <Field label={t('changePassword.new')}>
        <Input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </Field>
      <PasswordChecklist password={next} />
      <Field label={t('changePassword.confirm')}>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch}
          required
        />
      </Field>
      {mismatch && <p className="text-[12px] text-k-danger">{t('changePassword.mismatch')}</p>}
      <Button type="submit" loading={loading} disabled={!canSubmit}>
        {t('changePassword.submit')}
      </Button>
    </form>
  );
}
