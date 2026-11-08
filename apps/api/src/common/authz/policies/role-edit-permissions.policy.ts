import { Permission, checkRoleEdit, ROLE_ERROR } from '@kobrax/shared';
import { allow, deny, type PolicyDefinition } from '../authz.types';
import type { RoleEditFacts } from '../facts-loader';

export interface RoleEditPermissionsInput {
  /** Clave del rol de la cuenta (`MANAGER`…). */
  key: string;
  /** El conjunto COMPLETO de permisos que el rol tendría. */
  permissions: string[];
}

/**
 * `role.editPermissions` (F14 · F7, D-3): cambiar los permisos de un rol de la cuenta. Las reglas son las de `checkRoleEdit` (`@kobrax/shared`), las
 * MISMAS que la web usa para avisar en vivo: el rol de administrador no se edita; los permisos reservados no se añaden ni se quitan; no se concede
 * lo que quien edita no tiene; las dependencias quedan satisfechas; a lo sumo un alcance de datos; quien pertenece al rol sólo puede quitarle permisos.
 * La versión del rol (edición simultánea) y el motivo los valida el servicio dentro de la transacción.
 */
export const roleEditPermissions: PolicyDefinition<RoleEditPermissionsInput, RoleEditFacts> = {
  name: 'role.editPermissions',
  loadFacts: (loader, input, tx) => loader.roleEditFacts(input.key, tx),
  decide: (actor, facts, input) => {
    if (!actor.can(Permission.ROLE_WRITE)) return deny('ROLE_WRITE_FORBIDDEN', 'No tienes permiso para editar roles');
    if (!facts.role) return deny(ROLE_ERROR.NOT_FOUND, 'El rol no existe en tu cuenta', 404);
    const violations = checkRoleEdit({
      targetKey: facts.role.key,
      catalog: facts.catalog,
      current: facts.role.permissions,
      desired: input.permissions,
      actorHas: (code) => actor.can(code),
      actorInTargetRole: facts.actorInTargetRole,
    });
    const first = violations[0];
    if (first) {
      return deny(first.code, first.message, first.status, { violations: violations.map((v) => ({ code: v.code, permissions: v.permissions })) });
    }
    return allow({ roleId: facts.role.id, version: facts.role.version, current: facts.role.permissions });
  },
};
