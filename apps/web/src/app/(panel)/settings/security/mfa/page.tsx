'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { postJson } from '@/lib/client';

type View = 'loading' | 'disabled' | 'enrolling' | 'codes' | 'enabled';

export default function MfaSettingsPage() {
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
    const { ok, data } = await postJson<{ otpauthUrl: string; secret: string }>('/api/account/mfa', { action: 'enroll' });
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? 'No se pudo iniciar el enrolamiento');
      return;
    }
    setSecret(data.secret);
    setQr(await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 }));
    setView('enrolling');
  }

  async function verify() {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson<{ backupCodes: string[] }>('/api/account/mfa', { action: 'verify', code });
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? 'Código inválido');
      setCode('');
      return;
    }
    setBackupCodes(data.backupCodes);
    setView('codes');
  }

  async function regenerate() {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson<{ backupCodes: string[] }>('/api/account/mfa', { action: 'regenerate' });
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? 'No se pudieron regenerar los códigos');
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
      setError(data.error?.message ?? 'No se pudo desactivar MFA');
      return;
    }
    setPassword('');
    setView('disabled');
  }

  function downloadCodes() {
    const blob = new Blob([`Códigos de respaldo Kobrax\n\n${backupCodes.join('\n')}\n`], { type: 'text/plain' });
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
        ← Seguridad
      </Link>
      <h1 className="text-2xl font-semibold text-k-navy">Verificación en dos pasos</h1>
      <div className="space-y-4 rounded-2xl border border-k-border bg-white p-6 shadow-k-card">
        <ErrorBanner message={error} />

        {view === 'loading' && <p className="text-[14px] text-k-text-2">Cargando…</p>}

        {view === 'disabled' && (
          <>
            <p className="text-[14px] text-k-text-2">
              La verificación en dos pasos añade un código temporal de tu app de autenticación al iniciar sesión.
            </p>
            <Button onClick={startEnroll} loading={busy}>
              Activar MFA
            </Button>
          </>
        )}

        {view === 'enrolling' && (
          <>
            <p className="text-[14px] text-k-text-2">Escanea el código con tu app de autenticación:</p>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="Código QR MFA" className="mx-auto h-[200px] w-[200px] rounded-lg border border-k-border" />
            )}
            <div className="rounded-lg border border-k-border bg-k-bg p-3 text-center">
              <p className="text-[11px] font-semibold uppercase text-k-text-2">Clave manual</p>
              <p className="mt-1 select-all break-all font-mono text-[14px] font-semibold text-k-navy">{secret}</p>
            </div>
            <p className="text-[13px] text-k-text-2">Ingresa el código de 6 dígitos:</p>
            <OtpInput value={code} onChange={setCode} error={!!error} />
            <Button onClick={verify} loading={busy} disabled={code.length !== 6}>
              Verificar y activar
            </Button>
          </>
        )}

        {view === 'codes' && (
          <>
            <h2 className="text-[15px] font-semibold text-k-text">Guarda tus códigos de respaldo</h2>
            <p className="text-[13px] text-k-text-2">Cada código sirve una sola vez. Guárdalos en un lugar seguro.</p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border border-k-border bg-k-bg p-3 font-mono text-[13px] text-k-text">
              {backupCodes.map((c) => (
                <li key={c} className="text-center">{c}</li>
              ))}
            </ul>
            <Button variant="ghost" onClick={downloadCodes}>
              Descargar códigos
            </Button>
            <Button onClick={() => setView('enabled')}>Listo</Button>
          </>
        )}

        {view === 'enabled' && (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-k-success-bg px-3 py-2 text-[13px] text-k-success">
              <span aria-hidden>✓</span> MFA está activo en tu cuenta.
            </div>
            <Button variant="ghost" onClick={regenerate} loading={busy}>
              Regenerar códigos de respaldo
            </Button>
            <div className="border-t border-k-border pt-4">
              <p className="text-[13px] font-medium text-k-text">Desactivar MFA</p>
              <p className="mt-1 text-[12px] text-k-text-2">Confirma con tu contraseña.</p>
              <div className="mt-2 space-y-2">
                <Field label="Contraseña">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button variant="ghost" onClick={disable} loading={busy} disabled={!password}>
                  Desactivar verificación en dos pasos
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
