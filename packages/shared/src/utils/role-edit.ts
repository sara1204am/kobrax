import { RoleType } from '../enums/role.enum.js';
import type { PermissionCatalogEntry, RoleDiff } from '../types/role.types.js';

/**
 * Reglas de edición de los permisos de un rol de la cuenta (F14 · F7, D-3).
 *
 * Son FUNCIONES PURAS en `shared` a propósito: la API las hace cumplir (política `role.editPermissions`) y la web las usa para avisar en
 * vivo (marcar una dependencia, bloquear un reservado) con exactamente la misma lógica. La web sólo avisa; quien decide es el servidor.
 */

/** Mínimo de caracteres del motivo de un cambio. */
export const ROLE_REASON_MIN_LENGTH = 5;

export const ROLE_ERROR = {
  /** El rol no se puede editar (`ACCOUNT_ADMIN`). */
  PROTECTED: 'ROLE_PROTECTED',
  /** Se intentó añadir o quitar un permiso reservado (`ADMIN_CORE` / `PLATFORM`). */
  RESERVED: 'ROLE_RESERVED',
  /** Un código que no existe en el catálogo. */
  UNKNOWN_PERMISSION: 'ROLE_UNKNOWN_PERMISSION',
  /** Se añade un permiso que quien edita no tiene. */
  GRANT_EXCEEDS_ACTOR: 'ROLE_GRANT_EXCEEDS_ACTOR',
  /** Falta un permiso del que otro depende. */
  DEPENDENCY: 'ROLE_DEPENDENCY',
  /** A lo sumo un permiso de alcance de datos (ninguno = «propio», el alcance del cobrador). */
  SCOPE: 'ROLE_SCOPE',
  /** Quien pertenece al rol que edita sólo puede quitarle permisos. */
  SELF_ELEVATION: 'ROLE_SELF_ELEVATION',
  /** Otra persona guardó antes: la versión cambió. */
  VERSION_CONFLICT: 'ROLE_VERSION_CONFLICT',
  /** El motivo falta o es demasiado corto. */
  REASON_REQUIRED: 'ROLE_REASON_REQUIRED',
  NOT_FOUND: 'ROLE_NOT_FOUND',
} as const;
export type RoleErrorCode = (typeof ROLE_ERROR)[keyof typeof ROLE_ERROR];

export const DATA_SCOPE_PERMISSIONS: readonly string[] = ['data:scope:all', 'data:scope:subtree', 'data:scope:branch'];

/** Un incumplimiento: qué regla y qué permisos lo causan (la web resalta esas filas). */
export interface RoleEditViolation {
  code: RoleErrorCode;
  /** Permisos implicados. */
  permissions: string[];
  message: string;
  /** Cómo responde la API: 403 = no autorizado; 422 = el conjunto pedido no es válido. */
  status: 403 | 422;
}

export interface RoleEditInput {
  /** Clave del rol que se edita. */
  targetKey: string;
  catalog: readonly Pick<PermissionCatalogEntry, 'code' | 'reserved' | 'requires'>[];
  /** Permisos que el rol tiene hoy. */
  current: readonly string[];
  /** Permisos que tendría. */
  desired: readonly string[];
  /** ¿Quien edita tiene este permiso? */
  actorHas: (code: string) => boolean;
  /** ¿Quien edita pertenece al rol que edita? */
  actorInTargetRole: boolean;
}

/** Diferencia entre dos conjuntos: lo añadido y lo quitado, ordenado. */
export function diffPermissions(base: readonly string[], next: readonly string[]): RoleDiff {
  const b = new Set(base);
  const n = new Set(next);
  return { added: [...n].filter((p) => !b.has(p)).sort(), removed: [...b].filter((p) => !n.has(p)).sort() };
}

/**
 * Valida el cambio de permisos de un rol. Devuelve TODOS los incumplimientos (vacío = válido) que EL CAMBIO provoca, en el orden de gravedad:
 * protegido → desconocido → reservado → lo que el actor no tiene → auto-elevación → dependencias → alcance (a lo sumo uno).
 */
export function checkRoleEdit(input: RoleEditInput): RoleEditViolation[] {
  const out: RoleEditViolation[] = [];
  if (input.targetKey === RoleType.ACCOUNT_ADMIN) {
    return [{ code: ROLE_ERROR.PROTECTED, permissions: [], message: 'El rol de administrador de la cuenta no se puede editar', status: 403 }];
  }

  const byCode = new Map(input.catalog.map((c) => [c.code, c]));
  const desired = new Set(input.desired);
  const { added, removed } = diffPermissions(input.current, [...desired]);

  // Las reglas de contenido miran sólo lo que el cambio TOCA: un rol que ya traía algo fuera de regla (un permiso retirado del catálogo, una
  // dependencia rota) no puede quedar atascado sin poder guardarse por un cambio que no tiene que ver.
  const unknown = added.filter((c) => !byCode.has(c));
  if (unknown.length) out.push({ code: ROLE_ERROR.UNKNOWN_PERMISSION, permissions: unknown, message: 'Hay permisos que no existen', status: 422 });

  const reserved = [...added, ...removed].filter((c) => byCode.get(c)?.reserved);
  if (reserved.length) out.push({ code: ROLE_ERROR.RESERVED, permissions: reserved, message: 'Hay permisos reservados que no se pueden añadir ni quitar', status: 403 });

  const exceeds = added.filter((c) => byCode.has(c) && !input.actorHas(c));
  if (exceeds.length) out.push({ code: ROLE_ERROR.GRANT_EXCEEDS_ACTOR, permissions: exceeds, message: 'No puedes conceder permisos que tú no tienes', status: 403 });

  if (input.actorInTargetRole && added.length) {
    out.push({ code: ROLE_ERROR.SELF_ELEVATION, permissions: added, message: 'No puedes ampliar los permisos de tu propio rol', status: 403 });
  }

  const missing = new Set<string>();
  const dependents = new Set<string>();
  // Lo que se AÑADE necesita sus dependencias…
  for (const code of added) {
    for (const req of byCode.get(code)?.requires ?? []) {
      if (!desired.has(req)) {
        missing.add(req);
        dependents.add(code);
      }
    }
  }
  // …y lo que se QUITA no puede dejar sin base a lo que se conserva.
  for (const code of desired) {
    for (const req of byCode.get(code)?.requires ?? []) {
      if (removed.includes(req) && !desired.has(req)) {
        missing.add(req);
        dependents.add(code);
      }
    }
  }
  if (missing.size) {
    out.push({ code: ROLE_ERROR.DEPENDENCY, permissions: [...new Set([...missing, ...dependents])], message: 'Faltan permisos de los que otros dependen', status: 422 });
  }

  const scopes = [...desired].filter((c) => DATA_SCOPE_PERMISSIONS.includes(c));
  if (scopes.length > 1 && added.some((c) => DATA_SCOPE_PERMISSIONS.includes(c))) {
    out.push({ code: ROLE_ERROR.SCOPE, permissions: scopes, message: 'Un rol no puede tener más de un alcance de datos', status: 422 });
  }
  return out;
}

/** Permisos de `desired` que se cierran sobre sus dependencias (útil para marcar automáticamente lo necesario en el editor). */
export function withDependencies(desired: readonly string[], catalog: readonly Pick<PermissionCatalogEntry, 'code' | 'requires'>[]): string[] {
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const out = new Set(desired);
  const stack = [...desired];
  while (stack.length) {
    const code = stack.pop()!;
    for (const req of byCode.get(code)?.requires ?? []) {
      if (!out.has(req)) {
        out.add(req);
        stack.push(req);
      }
    }
  }
  return [...out];
}
