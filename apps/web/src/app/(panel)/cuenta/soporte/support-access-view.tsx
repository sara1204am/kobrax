'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { EmptyState } from '@/components/panel-ui';
import { postJson } from '@/lib/client';

export interface SupportSessionRow {
  id: string;
  reason: string;
  ticket?: string;
  permissions: string[];
  sensitive: boolean;
  consentStatus: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
  /** ACTIVE | AWAITING_CONSENT | EXPIRED | REVOKED (calculado por la API). */
  status: 'ACTIVE' | 'AWAITING_CONSENT' | 'EXPIRED' | 'REVOKED' | 'DENIED';
}

type Action = 'grant' | 'deny' | 'revoke';

/** La hora de vencimiento en la zona de la cuenta (la misma que ve el resto del panel). */
const when = (iso: string, timezone: string | null): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(iso));

/**
 * F14 · F5 (H-11): los accesos de soporte de la plataforma a esta cuenta. La persona que administra la cuenta ve cada acceso, qué puede hacer y hasta
 * cuándo; acepta o rechaza la escritura sensible y puede cortar cualquier acceso en cualquier momento. La API valida todo: esto es sólo la pantalla.
 */
export function SupportAccessView({ initial, timezone }: { initial: SupportSessionRow[]; timezone: string | null }) {
  const t = useTranslations('account.support');
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: Action) {
    setBusy(`${id}:${action}`);
    setError(null);
    const { ok, data } = await postJson<SupportSessionRow>(`/api/support-access/${id}/${action}`, {});
    setBusy(null);
    if (!ok) {
      setError((data as { error?: { message?: string } }).error?.message ?? t('error'));
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...(data as SupportSessionRow) } : r)));
  }

  return (
    <section aria-labelledby="support-title" className="space-y-4">
      <div>
        <h2 id="support-title" className="text-[18px] font-semibold text-k-navy">
          {t('title')}
        </h2>
        <p className="mt-1 max-w-3xl text-[14px] text-k-text-2">{t('intro')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-k-danger-bg px-3 py-2 text-[13px] text-k-danger">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const open = r.status === 'ACTIVE' || r.status === 'AWAITING_CONSENT';
            return (
              <li key={r.id} className="rounded-lg border border-k-border bg-white p-4 shadow-k-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-k-text">{r.reason}</p>
                    <p className="mt-0.5 text-[12px] text-k-muted">
                      {r.ticket ? `${t('ticket')}: ${r.ticket} · ` : ''}
                      {t('expires')}: {when(r.expiresAt, timezone)}
                    </p>
                    <p className="mt-1 text-[13px] text-k-text-2">{r.sensitive ? t('writes') : t('readOnly')}</p>
                    {r.status === 'AWAITING_CONSENT' && <p className="mt-1 text-[13px] text-k-warning-text">{t('consentNote')}</p>}
                  </div>
                  <span className="rounded-full bg-k-light-bg px-2.5 py-1 text-[12px] font-medium text-k-slate">{t(`status.${r.status}`)}</span>
                </div>
                {open && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.status === 'AWAITING_CONSENT' && (
                      <>
                        <Button type="button" disabled={busy !== null} onClick={() => void act(r.id, 'grant')}>
                          {busy === `${r.id}:grant` ? t('working') : t('grant')}
                        </Button>
                        <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void act(r.id, 'deny')}>
                          {busy === `${r.id}:deny` ? t('working') : t('deny')}
                        </Button>
                      </>
                    )}
                    <Button type="button" variant="danger" disabled={busy !== null} onClick={() => void act(r.id, 'revoke')}>
                      {busy === `${r.id}:revoke` ? t('working') : t('revoke')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
