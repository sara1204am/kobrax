/**
 * Lo que una pantalla pide para abrirse: un permiso, o «cualquiera de» una lista.
 * Cadenas y no `Permission` para que sirva igual con los permisos que llegan de `/auth/me`.
 */
export type PermissionNeed = string | { anyOf: readonly string[] };

/** `ok` = puede; `denied` = la API contestó y no tiene el permiso; `error` = no se pudo saber (red, 5xx): se reintenta, no se dice «sin acceso». */
export type AccessDecision = 'ok' | 'denied' | 'error';

/**
 * Decide con la respuesta de `/auth/me`. Un 401/403 es «sin acceso»; cualquier otra falla (status 0, 5xx) es `error`:
 * mostrarla como «sin acceso» le diría a alguien con permiso que no lo tiene, solo porque la API tropezó.
 *
 * 🔴 Es la puerta de la pantalla, no la autorización: la API valida cada llamada igual.
 */
export function decideAccess(me: { status: number; permissions?: readonly string[] }, need: PermissionNeed): AccessDecision {
  if (me.status === 401 || me.status === 403) return 'denied';
  if (me.status !== 200 || !me.permissions) return 'error';
  const wanted = typeof need === 'string' ? [need] : need.anyOf;
  const granted = new Set(me.permissions);
  return wanted.some((p) => granted.has(p)) ? 'ok' : 'denied';
}
