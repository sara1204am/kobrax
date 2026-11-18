'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner } from '@/components/ui';
import { postJson } from '@/lib/client';

/**
 * La persona abrió el enlace del correo. Confirmar es un botón (un POST), no la carga de la página: así un escáner de enlaces del correo que
 * abra la URL no confirma nada por su cuenta.
 */
export function PublicReportVerify({ token }: { token: string }) {
  const t = useTranslations('report.verify');
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setState('loading');
    const { ok, data } = await postJson<{ reference?: string }>('/api/public/reports/confirm', { token });
    if (!ok) {
      setState('idle');
      setError(data.error?.message ?? t('error'));
      return;
    }
    setReference((data as { reference?: string }).reference ?? '');
    setState('done');
  }

  if (state === 'done') {
    return (
      <div role="status" className="rounded-2xl border border-k-border bg-white px-6 py-6 shadow-k-card">
        <h2 className="text-k-xl font-semibold text-k-navy">{t('doneTitle')}</h2>
        <p className="mt-2 text-k-base text-k-text-2">{t('doneBody')}</p>
        {reference && <p className="mt-3 text-k-sm text-k-muted">{t('reference', { code: reference })}</p>}
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
