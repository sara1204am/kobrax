/**
 * Un aviso para la pantalla de ingreso cuando la sesión terminó por una razón que la persona tiene que entender (F14 · F8, D-3): hoy, que su rol
 * pasó a uno que no usa la app. Vive en memoria y se entrega una sola vez; sin él, la app volvería al login sin explicar nada.
 */
let notice: string | null = null;

export function setSessionNotice(message: string | null): void {
  notice = message;
}

/** Lo entrega y lo olvida. */
export function takeSessionNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}
