/**
 * ¿Puede esta persona hacer X? (0.8). Una sola forma de preguntarlo en el móvil.
 *
 * 🔴 Esto **solo decide qué se ofrece**: ocultar una fila es UX, no seguridad. La API es quien autoriza (403) y manda sobre lo
 * que diga esta lista, que viene de `GET /auth/me` y puede estar vieja si se leyó sin señal.
 */
import type { Permission } from '@kobrax/shared';

type Perms = readonly string[] | null | undefined;

export function can(permissions: Perms, permission: Permission | string): boolean {
  return !!permissions && permissions.includes(permission);
}

/** Cualquiera de ellos alcanza. */
export function canAny(permissions: Perms, wanted: readonly (Permission | string)[]): boolean {
  return wanted.some((p) => can(permissions, p));
}

/** Hacen falta todos. */
export function canAll(permissions: Perms, wanted: readonly (Permission | string)[]): boolean {
  return wanted.every((p) => can(permissions, p));
}
