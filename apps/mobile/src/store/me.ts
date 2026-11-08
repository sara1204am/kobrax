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
  /**
   * ¿Ya se sabe quién es (o se sabe que NO hay nadie)? Antes de saberlo se ofrece todo (no se esconde nada por no saber); **después de cerrar sesión se
   * falla cerrado**: sin identidad no se ofrece nada, ni siquiera un parpadeo con los permisos de quien salió.
   */
  known: boolean;
  setMe: (me: Me | null) => void;
  /** Cierre de sesión: no hay nadie. */
  clearMe: () => void;
}

export const useMeStore = create<MeState>((set) => ({
  me: null,
  known: false,
  setMe: (me) => set({ me, known: me !== null }),
  clearMe: () => set({ me: null, known: true }),
}));

/** La identidad actual (o `null` mientras no se leyó). */
export function useMe(): Me | null {
  return useMeStore((s) => s.me);
}

/**
 * ¿Puede hacer X? **Mientras `me` no se leyó responde `true`** (y tras cerrar sesión, `false`) (no se esconde nada por no saber: el arranque lee `me` del teléfono en
 * milisegundos y parpadear tabs peor que ofrecerlos un instante; la API igual rechaza lo que no corresponda).
 */
export function useCan(permission: string): boolean {
  return useMeStore((s) => (s.me !== null ? s.me.permissions.includes(permission) : !s.known));
}

/** Lo mismo, fuera de un componente. */
export function canNow(permission: string): boolean {
  const { me, known } = useMeStore.getState();
  return me !== null ? me.permissions.includes(permission) : !known;
}
