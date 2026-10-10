'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  judgeSession,
  SESSION_NOTICE_KEY,
  SESSION_STALE_EVENT,
  setLoadedSessionId,
  subscribeSessionEvents,
  type LoadedSession,
} from '@/lib/session-sync';

/** Mínimo entre dos comprobaciones por foco: alternar de pestaña rápido no debe llamar a la API cada vez. */
const RECHECK_MIN_MS = 2000;

/**
 * Vigila que la sesión de esta pestaña siga siendo la del navegador (W-LOG-54).
 *
 * - **Logout en otra pestaña** → `/login` al instante, sin esperar un clic (los datos de deudores
 *   no quedan a la vista).
 * - **Otro usuario o empresa** → recarga con un aviso «Tu sesión cambió en otra pestaña».
 * - Al **recuperar el foco** se vuelve a comprobar contra `/api/auth/me`: cubre la pestaña dormida
 *   que no recibió el aviso.
 * - Un **409 SESSION_CHANGED** del BFF (la pestaña intentó guardar con la sesión vieja) muestra
 *   «Recarga la página para continuar»; el servidor ya rechazó la acción.
 */
export function SessionWatcher({ session }: { session: LoadedSession }) {
  const t = useTranslations('panel.session');
  const [banner, setBanner] = useState<'reloaded' | 'stale' | null>(null);
  const lastCheck = useRef(0);
  const { userId, accountId, sessionId } = session;

  // Cada pedido de esta pestaña lleva la sesión con la que se cargó.
  useEffect(() => {
    setLoadedSessionId(sessionId);
    return () => setLoadedSessionId(null);
  }, [sessionId]);

  // Tras una recarga provocada por este mismo mecanismo, se avisa qué pasó.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_NOTICE_KEY)) {
        sessionStorage.removeItem(SESSION_NOTICE_KEY);
        setBanner('reloaded');
      }
    } catch {
      /* sessionStorage bloqueado */
    }
  }, []);

  useEffect(() => {
    let alive = true;

    const reload = () => {
      try {
        sessionStorage.setItem(SESSION_NOTICE_KEY, '1');
      } catch {
        /* se recarga igual, sin aviso */
      }
      window.location.reload();
    };

    async function recheck(force = false) {
      const now = Date.now();
      if (!force && now - lastCheck.current < RECHECK_MIN_MS) return;
      lastCheck.current = now;
      let res: Response;
      try {
        res = await fetch('/api/auth/me', { cache: 'no-store' });
      } catch {
        return; // sin red no se adivina nada
      }
      if (!alive) return;
      if (res.status === 401) {
        window.location.replace('/login');
        return;
      }
      if (!res.ok) return;
      const me = (await res.json().catch(() => null)) as {
        userId?: string;
        accountId?: string;
        sessionId?: string;
      } | null;
      if (!alive || !me) return;
      if (judgeSession({ userId, accountId, sessionId }, me) === 'changed') reload();
    }

    const unsubscribe = subscribeSessionEvents((event) => {
      if (event.type === 'logout') {
        window.location.replace('/login');
        return;
      }
      void recheck(true);
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    const onFocus = () => void recheck();
    const onStale = () => setBanner('stale');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener(SESSION_STALE_EVENT, onStale);
    return () => {
      alive = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SESSION_STALE_EVENT, onStale);
    };
  }, [userId, accountId, sessionId]);

  if (!banner) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border-l-[3px] border-k-warning bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text"
    >
      <span>{banner === 'stale' ? t('stale') : t('reloaded')}</span>
      {banner === 'stale' ? (
        <button type="button" onClick={() => window.location.reload()} className="font-medium underline">
          {t('reload')}
        </button>
      ) : (
        <button type="button" onClick={() => setBanner(null)} className="font-medium underline">
          {t('dismiss')}
        </button>
      )}
    </div>
  );
}
