import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'required_permissions';

/**
 * Exige que el usuario tenga TODOS los permisos indicados (código `{recurso}:{acción}`).
 * Se usa junto a `JwtAuthGuard` + `RolesGuard`:
 *   `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('user:read')`
 */
export const Roles = (...permissions: string[]) => SetMetadata(ROLES_KEY, permissions);
