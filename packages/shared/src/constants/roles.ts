import { RoleType } from '../enums/role.enum.js';

/**
 * Roles que se pueden asignar por API/web/móvil (módulo CUENTA · D2). `MANAGER` (gerente regional) entra con F13: exige una oficina.
 * Los demás (`AUDITOR`, `VIEWER`, `SUPER_ADMIN`) se administran desde la web:
 * el móvil los muestra en lectura y no los pisa.
 *
 * Es una regla de **servidor**, no de UI: `PATCH /api/users/:id` rechaza un
 * `roleId` que no esté acá aunque el cliente lo mande a mano.
 */
export const MOBILE_ROLES = [RoleType.ACCOUNT_ADMIN, RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR] as const;

export type MobileRole = (typeof MOBILE_ROLES)[number];

/** Código con el que la API rechaza el login/refresh del canal móvil a un rol que no es de campo (H-5, F14 · F8 D-3). */
export const MOBILE_ROLE_NOT_ALLOWED = 'MOBILE_ROLE_NOT_ALLOWED';

export function isMobileRole(roleName: string): roleName is MobileRole {
  return (MOBILE_ROLES as readonly string[]).includes(roleName);
}

/** Etiqueta es-LatAm por rol. Fuente única: la usan móvil y web. */
export const ROLE_LABEL: Record<RoleType, string> = {
  [RoleType.SUPER_ADMIN]: 'Super administrador',
  [RoleType.ACCOUNT_ADMIN]: 'Administrador',
  [RoleType.MANAGER]: 'Gerente',
  [RoleType.SUPERVISOR]: 'Supervisor',
  [RoleType.COLLECTOR]: 'Cobrador',
  [RoleType.AUDITOR]: 'Auditor',
  [RoleType.VIEWER]: 'Consulta',
};
