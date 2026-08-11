'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { postJson } from '@/lib/client';

type View = 'loading' | 'disabled' | 'enrolling' | 'codes' | 'enabled';

export default function MfaSettingsPage() {
  const t = useTranslations('security.mfa');
  const tc = useTranslations('security');
  const [view, setView] = useState<View>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // enroll
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  // disable
  const [password, setPassword] = useState('');

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        window.location.href = '/login';
        return;
      }
      const me = (await res.json()) as { mfaEnabled?: boolean };
      setView(me.mfaEnabled ? 'enabled' : 'disabled');
    })();
  }, []);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson<{ otpauthUrl: string; secret: string }>('/api/account/mfa', {
      action: 'enroll',
    });
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('startError'));
      return;
    }
    setSecret(data.secret);
    setQr(await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 }).catch(() => ''));
    setView('enrolling');
  }

  async function verify() {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson<{ backupCodes: string[] }>('/api/account/mfa', {
      action: 'verify',
      code,
    });
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('invalidCode'));
      setCode('');
      return;
    }
    setBackupCodes(data.backupCodes);
    setView('codes');
  }

  async function regenerate() {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson<{ backupCodes: string[] }>('/api/account/mfa', {
      action: 'regenerate',
    });
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('regenerateError'));
      return;
    }
    setBackupCodes(data.backupCodes);
    setView('codes');
  }

  async function disable() {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson('/api/account/mfa', { action: 'disable', password });
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('disableError'));
      return;
    }
    setPassword('');
    setView('disabled');
  }

  function downloadCodes() {
    const blob = new Blob([`${t('fileHeader')}\n\n${backupCodes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kobrax-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Link href="/settings/security" className="text-[13px] font-medium text-k-purple">
        ← {tc('back')}
      </Link>
      <h1 className="text-2xl font-semibold text-k-navy">{t('title')}</h1>
      <div className="space-y-4 rounded-2xl border border-k-border bg-white p-6 shadow-k-card">
        <ErrorBanner message={error} />

        {view === 'loading' && <p className="text-[14px] text-k-text-2">{tc('loading')}</p>}

        {view === 'disabled' && (
          <>
            <p className="text-[14px] text-k-text-2">{t('intro')}</p>
            <Button onClick={startEnroll} loading={busy}>
              {t('activate')}
            </Button>
          </>
        )}

        {view === 'enrolling' && (
          <>
            <p className="text-[14px] text-k-text-2">{t('scan')}</p>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element -- data: URI generada en el navegador
              <img
                src={qr}
                alt={t('qrAlt')}
                className="mx-auto h-[200px] w-[200px] rounded-lg border border-k-border"
              />
            )}
            <div className="rounded-lg border border-k-border bg-k-bg p-3 text-center">
              <p className="text-[11px] font-semibold uppercase text-k-text-2">{t('manualKey')}</p>
              <p className="mt-1 select-all break-all font-mono text-[14px] font-semibold text-k-navy">
                {secret}
              </p>
            </div>
            <p className="text-[13px] text-k-text-2">{t('enterCode')}</p>
            <OtpInput value={code} onChange={setCode} error={!!error} />
            <Button onClick={verify} loading={busy} disabled={code.length !== 6}>
              {t('verify')}
            </Button>
          </>
        )}

        {view === 'codes' && (
          <>
            <h2 className="text-[15px] font-semibold text-k-text">{t('codesTitle')}</h2>
            <p className="text-[13px] text-k-text-2">{t('codesText')}</p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border border-k-border bg-k-bg p-3 font-mono text-[13px] text-k-text">
              {backupCodes.map((c) => (
                <li key={c} className="text-center">
                  {c}
                </li>
              ))}
            </ul>
            <Button variant="ghost" onClick={downloadCodes}>
              {t('download')}
            </Button>
            <Button onClick={() => setView('enabled')}>{t('done')}</Button>
          </>
        )}

        {view === 'enabled' && (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-k-success-bg px-3 py-2 text-[13px] text-k-success">
              <span aria-hidden>✓</span> {t('active')}
            </div>
            <Button variant="ghost" onClick={regenerate} loading={busy}>
              {t('regenerate')}
            </Button>
            <div className="border-t border-k-border pt-4">
              <p className="text-[13px] font-medium text-k-text">{t('disableTitle')}</p>
              <p className="mt-1 text-[12px] text-k-text-2">{t('disableHint')}</p>
              <div className="mt-2 space-y-2">
                <Field label={t('password')}>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button variant="ghost" onClick={disable} loading={busy} disabled={!password}>
                  {t('disable')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
