import { RoleType } from '@kobrax/shared';

/** Un rol tal como las políticas lo necesitan: su nombre y su nivel numérico. */
export interface RoleFact {
  name: string;
  level: number;
}

/**
 * F14 · F2 (D-1): el «tier» de un rol — la jerarquía con la que se comparan las personas (quién puede invitar o asignar a quién).
 * Hoy sale de `roles.level`; cuando existan los roles por cuenta (F5) sólo cambia esta función por `account_roles.tier`.
 * Es la ÚNICA fuente: ninguna decisión compara nombres de rol ni `level` por su cuenta.
 */
export function tierOf(role: RoleFact): number {
  return role.level;
}

/** Roles que no se otorgan por invitación ni por cambio de rol (H-13: el ACCOUNT_ADMIN lo asigna sólo la plataforma). */
export const RESERVED_ROLES: readonly string[] = [RoleType.SUPER_ADMIN, RoleType.ACCOUNT_ADMIN];

export function isReservedRole(role: RoleFact): boolean {
  return RESERVED_ROLES.includes(role.name);
}

/** ¿`path` cuelga ESTRICTAMENTE de alguna de las rutas (la misma oficina no cuenta)? */
export function strictlyBelow(path: string, ancestors: readonly string[]): boolean {
  return ancestors.some((a) => path.length > a.length && path.startsWith(a));
}
