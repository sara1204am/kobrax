'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { allPassed, PasswordChecklist } from '@/components/password-checklist';
import { postJson } from '@/lib/client';

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !!current && allPassed(next) && next === confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson('/api/account/change-password', {
      currentPassword: current,
      newPassword: next,
    });
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? 'No se pudo cambiar la contraseña');
      return;
    }
    // El backend revocó todas las sesiones → el BFF limpió las cookies. Redirige al login.
    setDone(true);
    setTimeout(() => {
      window.location.href = '/login';
    }, 1800);
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-k-border bg-white p-6 shadow-k-card">
        <h1 className="text-xl font-semibold text-k-navy">Contraseña actualizada</h1>
        <p className="mt-2 text-[14px] text-k-text-2">
          Por seguridad cerramos todas tus sesiones. Inicia sesión de nuevo…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/settings/security" className="text-[13px] font-medium text-k-purple">
        ← Seguridad
      </Link>
      <h1 className="text-2xl font-semibold text-k-navy">Cambiar contraseña</h1>
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-k-border bg-white p-6 shadow-k-card" noValidate>
        <ErrorBanner message={error} />
        <Field label="Contraseña actual">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="Nueva contraseña">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <PasswordChecklist password={next} />
        <Field label="Confirmar nueva contraseña">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch} required />
        </Field>
        {mismatch && <p className="text-[12px] text-k-danger">Las contraseñas no coinciden.</p>}
        <Button type="submit" loading={loading} disabled={!canSubmit}>
          Actualizar contraseña
        </Button>
      </form>
    </div>
  );
}
