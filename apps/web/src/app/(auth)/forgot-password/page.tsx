'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { postJson } from '@/lib/client';

export default function ForgotPasswordPage() {
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
      setError(data.error?.message ?? 'No se pudo procesar la solicitud');
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Revisa tu correo" subtitle="Si la dirección existe, te enviamos un enlace para restablecer tu contraseña.">
        <Link href="/login" className="text-[13px] font-medium text-k-purple">
          ← Volver a iniciar sesión
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Recuperar contraseña" subtitle="Te enviaremos un enlace para restablecerla.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <ErrorBanner message={error} />
        <Field label="Correo">
          <Input
            type="email"
            autoComplete="email"
            placeholder="tu@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" loading={loading} disabled={!email}>
          Enviar enlace
        </Button>
        <Link href="/login" className="block text-center text-[13px] font-medium text-k-purple">
          Volver a iniciar sesión
        </Link>
      </form>
    </AuthShell>
  );
}
