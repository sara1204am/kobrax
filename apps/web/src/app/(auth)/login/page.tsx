'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <AuthShell eyebrow="Bienvenido de vuelta" title="Inicia sesión" subtitle="Accede a tu panel de cobranzas">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <ErrorBanner message={error} />

        <Field label="Correo electrónico">
          <Input
            type="email"
            autoComplete="email"
            placeholder="ejemplo@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<IconMail />}
            error={!!error}
            required
          />
        </Field>

        <div className="space-y-2">
          <Field label="Contraseña">
            <Input
              type="password"
              reveal
              autoComplete="current-password"
              placeholder="Ingresa tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<IconLock />}
              error={!!error}
              required
            />
          </Field>
          <Link href="/forgot-password" className="inline-block text-[13px] font-medium text-k-purple hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <Button type="submit" variant="cta" loading={loading}>
          Iniciar sesión
        </Button>
      </form>

      {/*
        El diseño sigue acá con «O continúa con» + Google y los enlaces a crear cuenta y unirse
        por invitación. No se dibujan todavía porque las tres cosas no existen: Google llega en la
        tarea 9 (necesita credenciales de Google Cloud) y /registro e /invitacion en las 4 y 5.
        Regla de la fase: no se pinta lo que no funciona.
      */}
    </AuthShell>
  );
}

function IconMail() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}
