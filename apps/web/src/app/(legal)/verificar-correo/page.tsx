import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EmailVerifyConfirm } from '@/components/email-verify-confirm';
import { PublicHeader, PublicHeaderLink } from '@/components/public-header';

/** El enlace del correo lleva un token de un solo uso: la página no se indexa. */
export const metadata: Metadata = { title: 'Kobrax', robots: { index: false, follow: false } };

/** Solo caracteres de base64url y largo acotado; cualquier otra cosa no es un token nuestro. */
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/** Confirmar el correo de la cuenta recién creada. No requiere sesión: se abre desde el correo. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: { token?: string } }) {
  const t = await getTranslations('emailVerify.page');
  const tl = await getTranslations('legal.document');
  const token = searchParams.token && TOKEN.test(searchParams.token) ? searchParams.token : null;
  return (
    <div className="min-h-screen bg-k-bg">
      <PublicHeader>
        <PublicHeaderLink href="/">{tl('backHome')}</PublicHeaderLink>
      </PublicHeader>
      <main className="mx-auto max-w-xl px-5 py-8">
        <h1 className="mb-2 text-k-4xl font-semibold text-k-navy">{t('title')}</h1>
        {token ? (
          <EmailVerifyConfirm token={token} />
        ) : (
          <p role="alert" className="rounded-xl border border-k-border bg-white px-5 py-4 text-k-base text-k-danger">
            {t('invalid')}
          </p>
        )}
      </main>
    </div>
  );
}
