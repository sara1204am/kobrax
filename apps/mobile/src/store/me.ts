/**
 * Quién es la persona de esta sesión y qué puede hacer (F14 · F8, D-9). Una sola fuente para toda la app: `authService.me()` la actualiza con cada
 * respuesta (de la red o, sin señal, la guardada) y `clearSession` la vacía.
 *
 * 🔴 Esto solo decide qué se OFRECE: ocultar un tab o un botón es UX, no seguridad. La API autoriza (403) y manda sobre lo que diga esta lista,
 * que puede estar vieja si se leyó sin señal.
 */
import { create } from 'zustand';
import type { Me } from '../auth-service';

interface MeState {
  me: Me | null;
  setMe: (me: Me | null) => void;
}

export const useMeStore = create<MeState>((set) => ({
  me: null,
  setMe: (me) => set({ me }),
}));

/** La identidad actual (o `null` mientras no se leyó). */
export function useMe(): Me | null {
  return useMeStore((s) => s.me);
}

/**
 * ¿Puede hacer X? **Mientras `me` no se leyó responde `true`** (no se esconde nada por no saber: el arranque lee `me` del teléfono en
 * milisegundos y parpadear tabs peor que ofrecerlos un instante; la API igual rechaza lo que no corresponda).
 */
export function useCan(permission: string): boolean {
  return useMeStore((s) => (s.me === null ? true : s.me.permissions.includes(permission)));
}

/** Lo mismo, fuera de un componente. */
export function canNow(permission: string): boolean {
  const me = useMeStore.getState().me;
  return me === null ? true : me.permissions.includes(permission);
}
