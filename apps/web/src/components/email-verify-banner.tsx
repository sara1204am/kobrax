'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';

/**
 * Aviso «Confirma tu correo» del panel, mientras la persona no haya confirmado que el correo es suyo. No bloquea nada: entrar y trabajar
 * sigue igual; solo invitar personas y exportar datos piden el correo confirmado (la API responde 403 `EMAIL_UNVERIFIED`).
 */
export function EmailVerifyBanner({ email }: { email: string }) {
  const t = useTranslations('emailVerify.banner');
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  async function resend() {
    setLoading(true);
    const { ok, data } = await postJson<{ sent?: boolean }>('/api/auth/email/resend', {});
    setLoading(false);
    if (!ok) return toast(data.error?.message ?? t('error'), 'danger');
    toast((data as { sent?: boolean }).sent ? t('sent', { email }) : t('wait'), 'success');
  }

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3">
      <p className="text-k-base text-k-warning-text">
        <span className="font-semibold">{t('title')}</span> {t('text', { email })}
      </p>
      <Button variant="secondary" size="sm" fullWidth={false} loading={loading} onClick={resend}>
        {t('resend')}
      </Button>
    </div>
  );
}
