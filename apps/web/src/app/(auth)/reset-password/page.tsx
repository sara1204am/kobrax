'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { allPassed, PasswordChecklist } from '@/components/password-checklist';
import { postJson } from '@/lib/client';

export default function ResetPasswordPage() {
  const router = useRouter();
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
      setError(data.error?.message ?? 'No se pudo restablecer la contraseña');
      return;
    }
    setDone(true);
    setTimeout(() => router.replace('/login'), 1500);
  }

  if (done) {
    return (
      <AuthShell title="Contraseña actualizada" subtitle="Ya puedes iniciar sesión con tu nueva contraseña.">
        <Link href="/login" className="text-[13px] font-medium text-k-purple">
          Ir a iniciar sesión
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Nueva contraseña" subtitle="Elige una contraseña segura.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <ErrorBanner message={error ?? (!token ? 'Falta el token de recuperación en el enlace' : null)} />
        <Field label="Nueva contraseña">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <PasswordChecklist password={password} />
        <Field label="Confirmar contraseña">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch}
            required
          />
        </Field>
        {mismatch && <p className="text-[12px] text-k-danger">Las contraseñas no coinciden.</p>}
        <Button type="submit" loading={loading} disabled={!canSubmit}>
          Restablecer contraseña
        </Button>
      </form>
    </AuthShell>
  );
}
