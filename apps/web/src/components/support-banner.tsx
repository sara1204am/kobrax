'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * «Sesión de soporte · vence HH:MM»: mientras la plataforma está dentro de esta cuenta, quien la mira lo sabe.
 * La hora se arma en el navegador (la del servidor sería de otra zona) y recién después de montar, para no desalinear el HTML.
 */
export function SupportBanner({ expiresAt }: { expiresAt: string }) {
  const t = useTranslations('panel.supportBanner');
  const [time, setTime] = useState('');
  useEffect(() => {
    const d = new Date(expiresAt);
    setTime(Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }, [expiresAt]);

  return (
    <div role="status" className="mb-5 rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
      <span className="font-semibold">{t('title')}</span> {time ? t('expires', { time }) : t('active')}
    </div>
  );
}
