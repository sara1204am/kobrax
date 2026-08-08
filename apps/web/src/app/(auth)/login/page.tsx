'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('login');
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
      setError(data.error?.message ?? t('error'));
      return;
    }
    routeByStep(router, data.step, data.accounts);
  }

  return (
    <AuthShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <ErrorBanner message={error} />

        <Field label={t('email')}>
          <Input
            type="email"
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<IconMail />}
            error={!!error}
            required
          />
        </Field>

        <div className="space-y-2">
          <Field label={t('password')}>
            <Input
              type="password"
              reveal
              autoComplete="current-password"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<IconLock />}
              error={!!error}
              required
            />
          </Field>
          <Link href="/forgot-password" className="inline-block text-[13px] font-medium text-k-purple hover:underline">
            {t('forgot')}
          </Link>
        </div>

        <Button type="submit" variant="cta" loading={loading}>
          {t('submit')}
        </Button>
      </form>

      {/*
        Falta el «O continúa con» + Google del diseño: no se pinta porque todavía no funciona
        (tarea 9, bloqueada por las credenciales de Google Cloud). Regla de la fase: no se dibuja
        lo que no anda.
      */}
      <div className="mt-6 space-y-2 border-t border-k-border pt-5 text-center text-[13px] text-k-text-2">
        <p>
          {t('noAccount')}{' '}
          <Link href="/registro" className="font-medium text-k-purple hover:underline">
            {t('createAccount')}
          </Link>
        </p>
        <p>
          {t('haveInvitation')}{' '}
          <Link href="/invitacion" className="font-medium text-k-purple hover:underline">
            {t('joinTeam')}
          </Link>
        </p>
      </div>
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
