'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { postJson } from '@/lib/client';

export default function ForgotPasswordPage() {
  const t = useTranslations('forgot');
  const tc = useTranslations('common');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson('/api/auth/forgot-password', { email });
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title={t('sentTitle')} subtitle={t('sentSubtitle')}>
        <Link href="/login" className="text-[13px] font-medium text-k-purple">
          ← {tc('backToLogin')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <ErrorBanner message={error} />
        <Field label={t('email')}>
          <Input
            type="email"
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" loading={loading} disabled={!email}>
          {t('submit')}
        </Button>
        <Link href="/login" className="block text-center text-[13px] font-medium text-k-purple">
          {tc('backToLogin')}
        </Link>
      </form>
    </AuthShell>
  );
}
