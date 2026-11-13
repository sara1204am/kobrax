/**
 * Roles de la cuenta (F14 · F7). Un solo recurso, `/roles`, para quien invita / asigna (web y móvil) y para el editor del administrador.
 *
 * `GET /roles` sin parámetros devuelve sólo lo OBLIGATORIO de `RoleSummary` (`id`, `name`, `level`) de los roles que quien pregunta
 * puede asignar: es el contrato que ya usan la web y los móviles instalados y NO cambia. Los campos opcionales los agrega el servidor
 * en la vista del administrador (`?assignable=false`) y el detalle; un cliente que no los conoce los ignora.
 */

/** De dónde vienen los permisos de un rol de la cuenta. */
export type RoleSource = 'TEMPLATE' | 'CUSTOM';

/** Alcance de datos que da el rol (el permiso `data:scope:*` que tiene). */
export type RoleScopeKind = 'ALL' | 'SUBTREE' | 'BRANCH' | 'OWN';

export interface RoleSummary {
  /** Identificador del rol para invitar o cambiar el rol de una persona (`roleId`). */
  id: string;
  name: string;
  level: number;
  /** Clave del rol de la cuenta (`MANAGER`…): identifica el rol en `/roles/:key`. */
  key?: string;
  /** `TEMPLATE` = copia de una plantilla; `CUSTOM` = nació en la cuenta. */
  source?: RoleSource;
  /** ¿Sus permisos difieren hoy de los de su plantilla? */
  diverged?: boolean;
  /** Personas activas con este rol. */
  members?: number;
  /** Permisos concedidos y total del catálogo concedible. */
  permissions?: number;
  permissionsTotal?: number;
  scopeKind?: RoleScopeKind | null;
  /** Versión del rol (se sube con cada cambio); el editor la manda de vuelta para detectar ediciones simultáneas. */
  version?: number;
  updatedAt?: string;
  /** ¿Se puede editar? (`ACCOUNT_ADMIN` no.) */
  editable?: boolean;
}

/** Lo que ya consumen la web y el móvil: el subconjunto obligatorio. */
export type AssignableRole = Pick<RoleSummary, 'id' | 'name' | 'level'>;

export type PermissionRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PermissionReserved = 'PLATFORM' | 'ADMIN_CORE';

/** Un permiso del catálogo, tal como lo necesita el editor. */
export interface PermissionCatalogEntry {
  code: string;
  /** Módulo (`client`, `credit`…): la parte anterior a `:` del código. */
  module: string;
  action: string;
  risk: PermissionRisk;
  /** `ADMIN_CORE` / `PLATFORM`: no se añade ni se quita en ningún rol desde el editor. */
  reserved: PermissionReserved | null;
  requires: string[];
  /** Nombre y descripción de respaldo (la web usa su propio texto traducido por código). */
  name: string;
  description: string | null;
}

export interface RoleDiff {
  /** Permisos que el rol tiene y su plantilla no. */
  added: string[];
  /** Permisos que la plantilla tiene y el rol no. */
  removed: string[];
}

export interface RoleDetail extends RoleSummary {
  templateKey: string | null;
  /** Los códigos de permisos concedidos. */
  granted: string[];
  /** Diferencia contra la plantilla (vacía si no hay plantilla). */
  diff: RoleDiff;
  /** Personas con este rol (para la pestaña «Personas»). */
  people: { userId: string; name: string; email: string; isActive: boolean }[];
}

export interface RoleCompareRow {
  code: string;
  a: boolean;
  b: boolean;
}

export interface RoleCompare {
  a: RoleSummary;
  b: RoleSummary;
  rows: RoleCompareRow[];
}

export interface RoleHistoryEntry {
  id: string;
  at: string;
  /** `ADMIN` = persona de la cuenta; `PLATFORM` = plataforma (rollout / soporte). */
  actorType: 'USER' | 'PLATFORM';
  actorName: string | null;
  action: 'ROLE_PERMISSIONS_UPDATED' | 'ROLE_RESTORED_TEMPLATE' | string;
  added: string[];
  removed: string[];
  reason: string | null;
}

export interface RoleHistoryPage {
  items: RoleHistoryEntry[];
  nextCursor: string | null;
}

/** Cuerpo de `PUT /roles/:key/permissions`. */
export interface UpdateRolePermissionsInput {
  /** El conjunto COMPLETO de permisos que el rol tendrá. */
  permissions: string[];
  /** La `version` del rol que la persona vio: si cambió, 409 `ROLE_VERSION_CONFLICT`. */
  expectedVersion: number;
  /** Obligatorio, mínimo `ROLE_REASON_MIN_LENGTH` caracteres. */
  reason: string;
}

/** Cuerpo de `POST /roles/:key/restore-template`. */
export interface RestoreRoleTemplateInput {
  expectedVersion: number;
  reason: string;
}

export interface RoleUpdateResult {
  role: RoleDetail;
  /** Personas cuyas sesiones se renuevan por el cambio. */
  affectedMembers: number;
}
