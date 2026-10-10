/**
 * El destino de un aviso que ABRIÓ la app (arranque en frío). El splash decide a dónde va el usuario según su sesión
 * (login, desbloqueo, home…), así que el destino del aviso se guarda acá y `routeAfterAuth` lo consume al aterrizar.
 *
 * Una sola vez: se consume al leerlo, para que un segundo arranque o un cierre de sesión no vuelva a abrir el mismo aviso.
 */
let pending: string | null = null;

export function setPendingTarget(target: string): void {
  pending = target;
}

/** Devuelve el destino pendiente y lo olvida. */
export function consumePendingTarget(): string | null {
  const target = pending;
  pending = null;
  return target;
}

/** Para pruebas y para el cierre de sesión: nada pendiente. */
export function clearPendingTarget(): void {
  pending = null;
}
