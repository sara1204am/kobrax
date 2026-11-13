/**
 * Un aviso para la pantalla de ingreso cuando la sesión terminó por una razón que la persona tiene que entender (F14 · F8, D-3): hoy, que su rol
 * pasó a uno que no usa la app. Vive en memoria y se entrega una sola vez. Si el ingreso ya estaba montado cuando se fijó (un refresco en segundo
 * plano), se avisa por suscripción; si nadie lo consume, `clearSessionNotice()` lo descarta al iniciar sesión para que no aparezca después, ajeno.
 */
let notice: string | null = null;
const listeners = new Set<(message: string) => void>();

export function setSessionNotice(message: string | null): void {
  notice = message;
  if (message) for (const l of listeners) l(message);
}

/** Lo entrega y lo olvida. */
export function takeSessionNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}

/** Descarta un aviso que nadie vio (p. ej. porque la persona inició sesión de nuevo). */
export function clearSessionNotice(): void {
  notice = null;
}

/** Para la pantalla de ingreso ya montada: se llama apenas aparece un aviso. Devuelve el `unsubscribe`. */
export function subscribeSessionNotice(listener: (message: string) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
