'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { allPassed, PasswordChecklist } from '@/components/password-checklist';
import { postJson, routeByStep, type AccountOption, type Step } from '@/lib/client';

/**
 * Registro público (`POST /accounts`). Crea el tenant y entra de una.
 *
 * El alta **no devuelve tokens**, así que acá se hace el login normal con lo que ya está en el
 * formulario y se delega el destino en `routeByStep`. Para un `ACCOUNT_ADMIN` eso significa
 * aterrizar en el enrolamiento de MFA, que su rol exige. Es la misma secuencia que ya recorrió el
 * módulo de Cuenta del móvil (S4-D1).
 *
 * País y moneda no se piden: arrancan en el default del mercado y se configuran después en los
 * datos de la cuenta (S4-D8).
 */
export default function RegistroPage() {
  const router = useRouter();
  const t = useTranslations('registro');
  const [form, setForm] = useState({
    businessName: '',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** La cuenta quedó creada pero el login posterior falló: reintentar el alta sería un 409. */
  const [created, setCreated] = useState(false);
  /** Alta OK y sesión resuelta: se confirma antes de mandarla al paso siguiente. */
  const [done, setDone] = useState<{ step: Step; accounts?: AccountOption[] } | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const email = form.email.trim().toLowerCase();
    const alta = await postJson('/api/auth/registro', {
      ...form,
      businessName: form.businessName.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email,
    });
    if (!alta.ok) {
      setLoading(false);
      setError(alta.data.error?.message ?? t('error'));
      return;
    }

    // De acá en adelante la cuenta ya existe: el camino es iniciar sesión, no volver a crearla.
    setCreated(true);
    const login = await postJson<{ step: Step; accounts?: AccountOption[] }>('/api/auth/login', {
      email,
      password: form.password,
    });
    setLoading(false);
    if (!login.ok) {
      setError(t('createdButLoginFailed', { detail: login.data.error?.message ?? '' }));
      return;
    }
    // No se salta directo: se confirma el alta antes de encajarle una pantalla de seguridad que
    // no pidió. El paso siguiente (casi siempre MFA) queda esperando el clic.
    setDone({ step: login.data.step, accounts: login.data.accounts });
  }

  if (done) {
    return (
      <AuthShell title={t('doneTitle')} subtitle={t('doneSubtitle')}>
        <div className="space-y-5">
          <dl className="rounded-xl bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
            <div className="flex gap-2">
              <dt>{t('yourEmail')}</dt>
              <dd className="font-medium text-k-text">{form.email.trim().toLowerCase()}</dd>
            </div>
            <div className="mt-1 flex gap-2">
              <dt>{t('yourBusiness')}</dt>
              <dd className="font-medium text-k-text">{form.businessName.trim()}</dd>
            </div>
          </dl>
          <Button variant="cta" onClick={() => routeByStep(router, done.step, done.accounts)}>
            {t('continue')}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')}>
      {/*
        Sin `noValidate`, al revés que el resto de las pantallas: este formulario tiene cuatro
        campos de texto y el navegador ya valida «requerido» y «forma de correo» gratis, con su
        mensaje en el idioma del sistema. La única regla que no sabe es la política de contraseña,
        y esa la gobierna `allPassed` — la misma de `@kobrax/shared` que valida el servidor.
      */}
      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorBanner message={error} />

        <Field label={t('businessName')}>
          <Input
            value={form.businessName}
            onChange={(e) => set('businessName')(e.target.value)}
            placeholder={t('businessNamePlaceholder')}
            minLength={2}
            maxLength={160}
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('firstName')}>
            <Input
              value={form.firstName}
              onChange={(e) => set('firstName')(e.target.value)}
              autoComplete="given-name"
              maxLength={80}
              required
            />
          </Field>
          <Field label={t('lastName')}>
            <Input
              value={form.lastName}
              onChange={(e) => set('lastName')(e.target.value)}
              autoComplete="family-name"
              maxLength={80}
              required
            />
          </Field>
        </div>

        <Field label={t('email')}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set('email')(e.target.value)}
            placeholder={t('emailPlaceholder')}
            autoComplete="email"
            required
          />
        </Field>

        <Field label={t('password')}>
          <Input
            type="password"
            reveal
            value={form.password}
            onChange={(e) => set('password')(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>
        <PasswordChecklist password={form.password} />

        {created ? (
          <Link
            href="/login"
            className="flex h-12 w-full items-center justify-center rounded-xl border border-k-border bg-white text-[15px] font-semibold text-k-text-2 hover:bg-k-bg"
          >
            {t('goToLogin')}
          </Link>
        ) : (
          <Button type="submit" variant="cta" loading={loading} disabled={!allPassed(form.password)}>
            {t('submit')}
          </Button>
        )}

        <Link href="/login" className="block text-center text-[13px] font-medium text-k-purple">
          {t('haveAccount')}
        </Link>
      </form>
    </AuthShell>
  );
}
