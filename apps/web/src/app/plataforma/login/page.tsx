'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { postJson } from '@/lib/client';

/**
 * Entrada a la consola de PLATAFORMA (la persona de Kobrax). No es el login de las empresas: no hay registro, ni recuperar contraseña, ni elegir
 * cuenta. Pide correo, contraseña y el código del MFA, y la sesión dura 15 minutos sin renovarse.
 */
export default function PlatformLoginPage() {
  const t = useTranslations('platform.login');
  const router = useRouter();
  const why = useSearchParams().get('e');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { ok, data } = await postJson('/api/plataforma/login', { email, password, code });
    setLoading(false);
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    router.replace('/plataforma');
  }

  const notice = why === 'expired' ? t('expired') : why === 'disabled' ? t('disabled') : null;

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {notice && (
          <p role="status" className="rounded-xl border border-k-border bg-white px-4 py-3 text-[13px] text-k-text-2">
            {notice}
          </p>
        )}
        <ErrorBanner message={error} />
        <Field label={t('email')}>
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t('password')}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label={t('code')} hint={t('codeHint')}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
        </Field>
        <Button type="submit" loading={loading} disabled={!email || !password || code.length < 6}>
          {t('submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
