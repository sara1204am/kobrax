import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'required_permissions';

/**
 * Exige que el usuario tenga TODOS los permisos indicados (código `{recurso}:{acción}`).
 * Alias de `@Authz({ all })` (F14 · F3). Los guards son globales: no hace falta `@UseGuards`.
 *   `@Roles('user:read')`
 */
export const Roles = (...permissions: string[]) => SetMetadata(ROLES_KEY, permissions);

export const ROLES_ANY_KEY = 'required_permissions_any';
/**
 * «Cualquiera de»: basta UNO de los permisos (`@Roles` exige todos). Alias de `@Authz({ any })` (F14 · F3).
 * Si además hay `@Roles`, se exigen ambas condiciones.
 */
export const RolesAny = (...permissions: string[]) => SetMetadata(ROLES_ANY_KEY, permissions);
