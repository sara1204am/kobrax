'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner } from '@/components/ui';
import { postJson } from '@/lib/client';

/** Confirmar el correo de la cuenta. Es un botón (un POST), no la carga de la página: un escáner de enlaces que abra la URL no confirma nada. */
export function EmailVerifyConfirm({ token }: { token: string }) {
  const t = useTranslations('emailVerify.page');
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setState('loading');
    const { ok, data } = await postJson('/api/auth/email/verify', { token });
    if (!ok) {
      setState('idle');
      setError(data.error?.message ?? t('error'));
      return;
    }
    setState('done');
  }

  if (state === 'done') {
    return (
      <div role="status" className="rounded-2xl border border-k-border bg-white px-6 py-6 shadow-k-card">
        <h2 className="text-k-xl font-semibold text-k-navy">{t('doneTitle')}</h2>
        <p className="mt-2 text-k-base text-k-text-2">{t('doneBody')}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-k-sm font-medium text-k-purple hover:underline">
          {t('goPanel')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-k-border bg-white px-6 py-6 shadow-k-card">
      <ErrorBanner message={error} />
      <p className="text-k-base text-k-text-2">{t('body')}</p>
      <Button onClick={confirm} loading={state === 'loading'}>
        {t('confirm')}
      </Button>
    </div>
  );
}
