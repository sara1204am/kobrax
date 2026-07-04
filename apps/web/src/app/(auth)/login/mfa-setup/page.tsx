'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

export default function MfaSetupPage() {
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState<{ step: Step; accounts?: AccountOption[] } | null>(null);

  // Arranca el enroll (genera el secreto) al entrar.
  useEffect(() => {
    void (async () => {
      const { ok, data } = await postJson<{ secret: string }>('/api/auth/mfa/setup', { action: 'start' });
      if (ok) setSecret(data.secret);
      else setError(data.error?.message ?? 'No se pudo iniciar la configuración');
    })();
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
      setError(data.error?.message ?? 'Código inválido');
      setCode('');
      return;
    }
    setBackupCodes(data.backupCodes);
    setPending({ step: data.step, accounts: data.accounts });
  }

  function downloadCodes() {
    if (!backupCodes) return;
    const blob = new Blob([`Códigos de respaldo Kobrax\n\n${backupCodes.join('\n')}\n`], {
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
      <AuthShell title="Guarda tus códigos de respaldo" subtitle="Úsalos si pierdes acceso a tu authenticator. Cada uno sirve una sola vez.">
        <div className="space-y-5">
          <ul className="grid grid-cols-2 gap-2 rounded-lg border border-k-border bg-k-bg p-3 font-mono text-[13px] text-k-text">
            {backupCodes.map((c) => (
              <li key={c} className="text-center">{c}</li>
            ))}
          </ul>
          <Button variant="ghost" onClick={downloadCodes}>
            Descargar códigos
          </Button>
          <Button onClick={() => routeByStep(router, pending.step, pending.accounts)}>
            Ya los guardé, continuar
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Paso 1: configurar el authenticator y verificar.
  return (
    <AuthShell title="Configura la verificación en dos pasos" subtitle="Tu rol requiere MFA. Escanea o ingresa esta clave en tu app de autenticación.">
      <div className="space-y-5">
        <ErrorBanner message={error} />
        <div className="rounded-lg border border-k-border bg-k-bg p-3 text-center">
          <p className="text-[11px] font-semibold uppercase text-k-text-2">Clave manual</p>
          <p className="mt-1 select-all break-all font-mono text-[15px] font-semibold text-k-navy">
            {secret || '···'}
          </p>
        </div>
        <p className="text-[13px] text-k-text-2">Luego ingresa el código de 6 dígitos que genera la app:</p>
        <div className={error ? 'k-shake' : ''}>
          <OtpInput value={code} onChange={setCode} error={!!error} />
        </div>
        <Button onClick={verify} loading={loading} disabled={code.length !== 6 || !secret}>
          Activar y continuar
        </Button>
      </div>
    </AuthShell>
  );
}
