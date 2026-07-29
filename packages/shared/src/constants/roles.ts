import { RoleType } from '../enums/role.enum.js';

/**
 * Roles que el móvil ofrece asignar (módulo CUENTA · D2). Los demás
 * (`MANAGER`, `AUDITOR`, `VIEWER`, `SUPER_ADMIN`) se administran desde la web:
 * el móvil los muestra en lectura y no los pisa.
 *
 * Es una regla de **servidor**, no de UI: `PATCH /api/users/:id` rechaza un
 * `roleId` que no esté acá aunque el cliente lo mande a mano.
 */
export const MOBILE_ROLES = [RoleType.ACCOUNT_ADMIN, RoleType.SUPERVISOR, RoleType.COLLECTOR] as const;

export type MobileRole = (typeof MOBILE_ROLES)[number];

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
