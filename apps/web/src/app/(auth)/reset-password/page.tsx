'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { allPassed, PasswordChecklist } from '@/components/password-checklist';
import { postJson } from '@/lib/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const t = useTranslations('reset');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Token desde la URL (?token=...), sin useSearchParams para evitar Suspense en build.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) setToken(t);
  }, []);

  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = !!token && allPassed(password) && password === confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson('/api/auth/reset-password', { token, newPassword: password });
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    setDone(true);
    setTimeout(() => router.replace('/login'), 1500);
  }

  if (done) {
    return (
      <AuthShell title={t('doneTitle')} subtitle={t('doneSubtitle')}>
        <Link href="/login" className="text-[13px] font-medium text-k-purple">
          {t('doneLink')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <ErrorBanner message={error ?? (!token ? t('missingToken') : null)} />
        <Field label={t('newPassword')}>
          <Input
            type="password"
            reveal
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <PasswordChecklist password={password} />
        <Field label={t('confirm')}>
          <Input
            type="password"
            reveal
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch}
            required
          />
        </Field>
        {mismatch && <p className="text-[12px] text-k-danger">{t('mismatch')}</p>}
        <Button type="submit" loading={loading} disabled={!canSubmit}>
          {t('submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
