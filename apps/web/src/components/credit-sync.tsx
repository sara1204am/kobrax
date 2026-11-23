'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Mantiene al día la pantalla de UN crédito cuando cambia en otra pestaña o cuando se vuelve a ella.
 *
 * No hay caché de datos en la web (server components + BFF): lo único que puede quedar viejo es lo que el navegador ya pintó. Dos
 * avisos bastan, y ninguno trae datos (siempre se vuelve a leer del servidor, que es la fuente):
 *  · `BroadcastChannel`: quien registra un pago avisa a las demás pestañas del mismo navegador (`notifyCreditChanged`);
 *  · al volver a la pestaña (`visibilitychange`): cubre otro navegador u otro usuario, sin sondeo.
 */
export const CREDIT_SYNC_CHANNEL = 'kobrax-credit';
/** Entre dos recargas, al menos esto: un aviso doble (broadcast + foco) no pide dos veces lo mismo. */
const MIN_GAP_MS = 1000;

/** Avisa a las demás pestañas que este crédito cambió (un pago, una gestión). Sin soporte de `BroadcastChannel` no hace nada. */
export function notifyCreditChanged(creditId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CREDIT_SYNC_CHANNEL);
    channel.postMessage({ creditId, at: Date.now() });
    channel.close();
  } catch {
    // Sin canal no hay aviso entre pestañas; el foco sigue cubriéndolo.
  }
}

export function CreditSync({ creditId }: { creditId: string }) {
  const router = useRouter();

  useEffect(() => {
    let last = 0;
    const refresh = (): void => {
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      router.refresh();
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(CREDIT_SYNC_CHANNEL);
        channel.onmessage = (e: MessageEvent<{ creditId?: string }>): void => {
          if (e.data?.creditId === creditId) refresh();
        };
      } catch {
        channel = null;
      }
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      channel?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [creditId, router]);

  return null;
}
