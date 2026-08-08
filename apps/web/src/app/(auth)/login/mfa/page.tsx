'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

export default function MfaPage() {
  const router = useRouter();
  const t = useTranslations('mfa');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    if (loading) return;
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson<{ step: Step; accounts?: AccountOption[] }>(
      '/api/auth/mfa/challenge',
      { code: value },
    );
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? t('invalid'));
      setCode('');
      return;
    }
    routeByStep(router, data.step, data.accounts);
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <div className="space-y-5">
        <ErrorBanner message={error} />
        {!useBackup ? (
          <>
            <div className={error ? 'k-shake' : ''}>
              <OtpInput value={code} onChange={setCode} error={!!error} autoFocus />
            </div>
            <Button onClick={() => submit(code)} loading={loading} disabled={code.length !== 6}>
              {t('verify')}
            </Button>
            <button
              type="button"
              onClick={() => setUseBackup(true)}
              className="w-full text-center text-[13px] font-medium text-k-purple"
            >
              {t('useBackup')}
            </button>
          </>
        ) : (
          <>
            <Field label={t('backupLabel')}>
              <Input
                placeholder="xxxxx-xxxxx"
                value={backup}
                onChange={(e) => setBackup(e.target.value)}
                error={!!error}
                autoFocus
              />
            </Field>
            <Button onClick={() => submit(backup)} loading={loading} disabled={backup.length < 6}>
              {t('verify')}
            </Button>
            <button
              type="button"
              onClick={() => setUseBackup(false)}
              className="w-full text-center text-[13px] font-medium text-k-purple"
            >
              {t('backToApp')}
            </button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
