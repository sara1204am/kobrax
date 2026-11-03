'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { SessionInfo } from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components/ui';

/**
 * Las sesiones abiertas de esta persona y cómo cerrarlas. Vive en la pestaña Seguridad de Mi
 * perfil; antes era una página aparte.
 */
export function SessionsList() {
  const t = useTranslations('security');
  const locale = useLocale();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/account/sessions');
    if (!res.ok) {
      if (res.status === 401) window.location.href = '/login';
      setError(t('sessions.loadError'));
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { sessions: SessionInfo[] };
    setSessions(data.sessions);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` es estable por namespace
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusy(id);
    await fetch(`/api/account/sessions/${id}`, { method: 'DELETE' });
    setBusy(null);
    await load();
  }

  async function revokeOthers() {
    setBusy('all');
    await fetch('/api/account/sessions', { method: 'DELETE' });
    setBusy(null);
    await load();
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {loading ? (
        <p className="text-[14px] text-k-text-2">{t('loading')}</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card"
            >
              <div>
                <p className="text-[15px] font-medium text-k-text">
                  {s.deviceType ?? t('sessions.device')} · {s.accountName}
                  {s.isCurrent && (
                    <span className="ml-2 rounded-full bg-k-success-bg px-2 py-0.5 text-[11px] font-medium text-k-success">
                      {t('sessions.current')}
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-k-text-2">
                  {[s.os, s.ip, s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString(locale) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {!s.isCurrent && (
                <button
                  onClick={() => revoke(s.id)}
                  disabled={!!busy}
                  className="text-[13px] font-medium text-k-danger disabled:opacity-50"
                >
                  {busy === s.id ? '···' : t('sessions.close')}
                </button>
              )}
            </div>
          ))}

          {sessions.filter((s) => !s.isCurrent).length > 0 && (
            <Button variant="ghost" onClick={revokeOthers} loading={busy === 'all'}>
              {t('sessions.closeOthers')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
