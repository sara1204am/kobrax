import { RoleType, diffPermissions, type AssignableRole, type RoleScopeKind, type RoleSummary } from '@kobrax/shared';

/** Una fila de `GET /roles` sin parámetros: EXACTAMENTE `{ id, name, level }` (el contrato que ya leen la web y los móviles instalados). */
export function serializeAssignableRole(role: { id: string; name: string; level: number }): AssignableRole {
  return { id: role.id, name: role.name, level: role.level };
}

/** Un rol de la cuenta tal como lo lee el servicio: sus permisos concedidos y los de su plantilla. */
export interface AccountRoleRow {
  id: string;
  key: string;
  tier: number;
  templateKey: string | null;
  version: number;
  divergedAt: Date | null;
  updatedAt: Date;
  granted: string[];
  templateGranted: string[] | null;
}

/** El alcance de datos que da un conjunto de permisos (ninguno = «propio», el del cobrador). */
export function scopeKindOf(granted: readonly string[]): RoleScopeKind {
  if (granted.includes('data:scope:all')) return 'ALL';
  if (granted.includes('data:scope:subtree')) return 'SUBTREE';
  if (granted.includes('data:scope:branch')) return 'BRANCH';
  return 'OWN';
}

/**
 * Resumen de un rol para la vista del administrador (`GET /roles?assignable=false`).
 * `id` es el identificador que ya usan invitar y cambiar el rol de una persona (el rol global de igual nombre, hasta que se retire `role_id`);
 * `key` es el que usa el editor. La divergencia se CALCULA contra la plantilla: es la verdad de la pantalla.
 */
export function summarizeRole(row: AccountRoleRow, ctx: { roleIdByName: ReadonlyMap<string, string>; members: number; permissionsTotal: number }): RoleSummary {
  const diff = row.templateGranted ? diffPermissions(row.templateGranted, row.granted) : { added: [], removed: [] };
  return {
    // Hoy cada rol de plantilla tiene su rol global de igual nombre. Si algún día un rol no lo tiene (roles propios, H-9), `id` pasa a ser el del
    // rol de la cuenta: es lo que ocurrirá de todos modos cuando se retire `user_accounts.role_id` (F5 D-3), y el cliente lo trata como opaco.
    id: ctx.roleIdByName.get(row.key) ?? row.id,
    name: row.key,
    level: row.tier,
    key: row.key,
    source: row.templateKey ? 'TEMPLATE' : 'CUSTOM',
    diverged: diff.added.length > 0 || diff.removed.length > 0,
    members: ctx.members,
    permissions: row.granted.length,
    permissionsTotal: ctx.permissionsTotal,
    scopeKind: scopeKindOf(row.granted),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    editable: row.key !== RoleType.ACCOUNT_ADMIN,
  };
}

/** Compara dos conjuntos de permisos: una fila por permiso que alguno de los dos tiene, ordenada por código. */
export function compareGranted(a: readonly string[], b: readonly string[]): { code: string; a: boolean; b: boolean }[] {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...new Set([...a, ...b])].sort().map((code) => ({ code, a: sa.has(code), b: sb.has(code) }));
}
