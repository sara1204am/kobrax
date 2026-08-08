'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { allPassed, PasswordChecklist } from '@/components/password-checklist';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

interface Invitation {
  email: string;
  firstName: string | null;
  businessName: string | null;
}

/** Longitudes que acepta el DTO de la API (`@Length(8, 24)`). */
const CODE_MIN = 8;
const CODE_MAX = 24;

/**
 * Ingreso por invitación. Dos pasos en una pantalla: **buscar** el código y, si existe, **fijar
 * la contraseña**.
 *
 * No existe tabla `account_invitations`: un invitado es un `User` en estado `PENDING` + token, así
 * que esto no consulta invitaciones sino al usuario pendiente. Aceptar tampoco devuelve tokens
 * (S2-D8), por eso al final se hace el login normal y lo enruta `routeByStep`.
 */
export default function InvitacionPage() {
  const router = useRouter();
  const t = useTranslations('invitacion');
  const [code, setCode] = useState('');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** La invitación ya se aceptó y el login posterior falló: reintentar sería un código usado. */
  const [accepted, setAccepted] = useState(false);

  async function lookup(raw: string) {
    setError(null);
    setLoading(true);
    // El código se manda como lo escribió la persona (con guiones o en minúscula): normalizarlo es
    // cosa del servidor, que es quien conoce el formato real del token.
    const res = await fetch(`/api/auth/invitacion/${encodeURIComponent(raw.trim())}`);
    const data = (await res.json().catch(() => ({}))) as Invitation & { error?: { message: string } };
    setLoading(false);
    if (!res.ok) {
      setError(data.error?.message ?? t('notFound'));
      return;
    }
    setInvitation(data);
  }

  // Código del link (`/invitacion?c=...`, el mismo parámetro que comparte el móvil por WhatsApp).
  // Sin `useSearchParams` para no arrastrar un Suspense al build.
  //
  // Deps vacías a propósito: esto es «leer el link al entrar», una sola vez. `lookup` se recrea en
  // cada render, así que ponerlo en las deps sería un bucle infinito de búsquedas.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c');
    if (c && c.length >= CODE_MIN) {
      setCode(c);
      void lookup(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function accept(e: FormEvent) {
    e.preventDefault();
    if (!invitation) return;
    setError(null);
    setLoading(true);

    const res = await postJson('/api/auth/invitacion', { code: code.trim(), password });
    if (!res.ok) {
      setLoading(false);
      setError(res.data.error?.message ?? t('acceptError'));
      return;
    }

    // El código ya se consumió: de acá en adelante el camino es iniciar sesión.
    setAccepted(true);
    const login = await postJson<{ step: Step; accounts?: AccountOption[] }>('/api/auth/login', {
      email: invitation.email,
      password,
    });
    setLoading(false);
    if (!login.ok) {
      setError(t('acceptedButLoginFailed', { detail: login.data.error?.message ?? '' }));
      return;
    }
    routeByStep(router, login.data.step, login.data.accounts);
  }

  // ── Paso 1: el código ────────────────────────────────────────────────────────
  if (!invitation) {
    return (
      <AuthShell title={t('title')} subtitle={t('subtitle')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(code);
          }}
          className="space-y-4"
        >
          <ErrorBanner message={error} />
          <Field label={t('code')}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('codePlaceholder')}
              className="font-mono tracking-[0.15em]"
              minLength={CODE_MIN}
              maxLength={CODE_MAX}
              autoFocus
              error={!!error}
            />
          </Field>
          <Button type="submit" variant="cta" loading={loading} disabled={code.trim().length < CODE_MIN}>
            {t('lookup')}
          </Button>
          <Link href="/login" className="block text-center text-[13px] font-medium text-k-purple">
            {t('backToLogin')}
          </Link>
        </form>
      </AuthShell>
    );
  }

  // ── Paso 2: la contraseña ────────────────────────────────────────────────────
  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <AuthShell
      eyebrow={invitation.firstName ? t('greeting', { name: invitation.firstName }) : undefined}
      title={t('joinTitle', { business: invitation.businessName ?? t('yourTeam') })}
      subtitle={t('joinSubtitle', { email: invitation.email })}
    >
      <form onSubmit={accept} className="space-y-4" noValidate>
        <ErrorBanner message={error} />

        <Field label={t('newPassword')}>
          <Input
            type="password"
            reveal
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <PasswordChecklist password={password} />

        <Field label={t('confirm')}>
          <Input
            type="password"
            reveal
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch}
            required
          />
        </Field>
        {mismatch && <p className="text-[12px] text-k-danger">{t('mismatch')}</p>}

        {accepted ? (
          <Link
            href="/login"
            className="flex h-12 w-full items-center justify-center rounded-xl border border-k-border bg-white text-[15px] font-semibold text-k-text-2 hover:bg-k-bg"
          >
            {t('goToLogin')}
          </Link>
        ) : (
          <Button
            type="submit"
            variant="cta"
            loading={loading}
            disabled={!allPassed(password) || password !== confirm}
          >
            {t('submit')}
          </Button>
        )}
      </form>
    </AuthShell>
  );
}
