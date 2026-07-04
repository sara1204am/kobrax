'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson<{ step: Step; accounts?: AccountOption[] }>('/api/auth/login', {
      email,
      password,
    });
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? 'No se pudo iniciar sesión');
      return;
    }
    routeByStep(router, data.step, data.accounts);
  }

  return (
    <AuthShell title="Inicia sesión" subtitle="Accede a tu panel de cobranzas">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <ErrorBanner message={error} />
        <Field label="Correo">
          <Input
            type="email"
            autoComplete="email"
            placeholder="tu@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<IconUser />}
            error={!!error}
            required
          />
        </Field>
        <Field label="Contraseña">
          <div className="relative">
            <Input
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<IconLock />}
              error={!!error}
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-k-purple"
            >
              {showPw ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </Field>
        <Button type="submit" loading={loading}>
          Entrar
        </Button>
        <a href="/forgot-password" className="block text-center text-[13px] font-medium text-k-purple">
          ¿Olvidaste tu contraseña?
        </a>
      </form>
    </AuthShell>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
