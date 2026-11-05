import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'required_permissions';

/**
 * Exige que el usuario tenga TODOS los permisos indicados (código `{recurso}:{acción}`).
 * Se usa junto a `JwtAuthGuard` + `RolesGuard`:
 *   `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('user:read')`
 */
export const Roles = (...permissions: string[]) => SetMetadata(ROLES_KEY, permissions);

export const ROLES_ANY_KEY = 'required_permissions_any';
/**
 * «Cualquiera de»: basta UNO de los permisos (`@Roles` exige todos). Interino de F14 · F1 hasta el `@Authz({ any })` de F3.
 * Si además hay `@Roles`, se exigen ambas condiciones.
 */
export const RolesAny = (...permissions: string[]) => SetMetadata(ROLES_ANY_KEY, permissions);
