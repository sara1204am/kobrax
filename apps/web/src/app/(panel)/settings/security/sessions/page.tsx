'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { SessionInfo } from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components/ui';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/account/sessions');
    if (!res.ok) {
      if (res.status === 401) window.location.href = '/login';
      setError('No se pudieron cargar las sesiones');
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { sessions: SessionInfo[] };
    setSessions(data.sessions);
    setLoading(false);
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
      <Link href="/settings/security" className="text-[13px] font-medium text-k-purple">
        ← Seguridad
      </Link>
      <h1 className="text-2xl font-semibold text-k-navy">Sesiones activas</h1>
      <ErrorBanner message={error} />

      {loading ? (
        <p className="text-[14px] text-k-text-2">Cargando…</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card">
              <div>
                <p className="text-[15px] font-medium text-k-text">
                  {s.deviceType ?? 'Dispositivo'} · {s.accountName}
                  {s.isCurrent && (
                    <span className="ml-2 rounded-full bg-k-success-bg px-2 py-0.5 text-[11px] font-medium text-k-success">
                      Esta sesión
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-k-text-2">
                  {[s.os, s.ip, s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString('es') : null]
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
                  {busy === s.id ? '···' : 'Cerrar'}
                </button>
              )}
            </div>
          ))}

          {sessions.filter((s) => !s.isCurrent).length > 0 && (
            <Button variant="ghost" onClick={revokeOthers} loading={busy === 'all'}>
              Cerrar todas las demás sesiones
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
