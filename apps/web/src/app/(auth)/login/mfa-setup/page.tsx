'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

export default function MfaSetupPage() {
  const router = useRouter();
  const t = useTranslations('mfaSetup');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState<{ step: Step; accounts?: AccountOption[] } | null>(null);

  // Arranca el enroll (genera el secreto) al entrar. Deps vacías a propósito: correrlo de nuevo
  // generaría un secreto nuevo y dejaría inservible el QR que la usuaria ya escaneó.
  useEffect(() => {
    void (async () => {
      const { ok, data } = await postJson<{ otpauthUrl: string; secret: string }>('/api/auth/mfa/setup', {
        action: 'start',
      });
      if (!ok) {
        setError(data.error?.message ?? t('startError'));
        return;
      }
      setSecret(data.secret);
      // La clave manual se pinta igual aunque el QR falle: es el camino de respaldo para escribirla
      // a mano, no un adorno del QR.
      setQr(await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 }).catch(() => ''));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify() {
    if (loading) return;
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson<{ step: Step; accounts?: AccountOption[]; backupCodes: string[] }>(
      '/api/auth/mfa/setup',
      { action: 'verify', code },
    );
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? t('invalid'));
      setCode('');
      return;
    }
    setBackupCodes(data.backupCodes);
    setPending({ step: data.step, accounts: data.accounts });
  }

  function downloadCodes() {
    if (!backupCodes) return;
    const blob = new Blob([`${t('fileHeader')}\n\n${backupCodes.join('\n')}\n`], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kobrax-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Paso 2: mostrar backup codes antes de continuar al destino.
  if (backupCodes && pending) {
    return (
      <AuthShell title={t('backupTitle')} subtitle={t('backupSubtitle')}>
        <div className="space-y-5">
          <ul className="grid grid-cols-2 gap-2 rounded-lg border border-k-border bg-k-bg p-3 font-mono text-[13px] text-k-text">
            {backupCodes.map((c) => (
              <li key={c} className="text-center">{c}</li>
            ))}
          </ul>
          <Button variant="ghost" onClick={downloadCodes}>
            {t('download')}
          </Button>
          <Button onClick={() => routeByStep(router, pending.step, pending.accounts)}>
            {t('saved')}
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Paso 1: configurar el authenticator y verificar.
  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <div className="space-y-5">
        <ErrorBanner message={error} />
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element -- data: URI generada en el navegador
          <img
            src={qr}
            alt={t('qrAlt')}
            width={200}
            height={200}
            className="mx-auto rounded-lg border border-k-border bg-white p-1"
          />
        )}
        <div className="rounded-lg border border-k-border bg-k-bg p-3 text-center">
          <p className="text-[11px] font-semibold uppercase text-k-text-2">{t('manualKey')}</p>
          <p className="mt-1 select-all break-all font-mono text-[15px] font-semibold text-k-navy">
            {secret || '···'}
          </p>
        </div>
        <p className="text-[13px] text-k-text-2">{t('thenEnter')}</p>
        <div className={error ? 'k-shake' : ''}>
          <OtpInput value={code} onChange={setCode} error={!!error} />
        </div>
        <Button onClick={verify} loading={loading} disabled={code.length !== 6 || !secret}>
          {t('activate')}
        </Button>
      </div>
    </AuthShell>
  );
}
