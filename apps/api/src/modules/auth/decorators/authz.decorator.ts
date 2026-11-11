import { SetMetadata } from '@nestjs/common';

/**
 * F14 · F3 (ADR-F14-03): el contrato de acceso de cada handler, declarado en UN solo lugar.
 *
 *  - `@Public()`        → sin sesión (login, alta de cuenta, salud).
 *  - `@Authenticated()` → sesión válida y nada más (perfil propio, MFA, notificaciones).
 *  - `@Authz({...})`    → permisos «todos» (`all`) y/o «alguno» (`any`).
 *  - `@Roles(...)` / `@RolesAny(...)` siguen valiendo: son alias de `@Authz({ all })` / `@Authz({ any })`.
 *  - `@Policy(nombre)`  → la decisión contextual (para quién, sobre qué fila) vive en esa política; el metadato permite auditar que existe.
 *  - `@Destructive()`   → marca la acción como de riesgo alto (la auditoría lo registra así). No exige confirmación (D-2).
 *
 * Un handler sin ninguno de estos recibe 403 `AUTHZ_000` (negación por defecto, ver `AuthzGuard`).
 */
export const AUTHZ_KEY = 'authz';
export const POLICY_KEY = 'authz_policy';
export const DESTRUCTIVE_KEY = 'authz_destructive';

export type AuthzDeclaration =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permissions'; all?: string[]; any?: string[] };

export const Public = () => SetMetadata(AUTHZ_KEY, { kind: 'public' } satisfies AuthzDeclaration);
export const Authenticated = () => SetMetadata(AUTHZ_KEY, { kind: 'authenticated' } satisfies AuthzDeclaration);
export const Authz = (spec: { all?: string[]; any?: string[] }) =>
  SetMetadata(AUTHZ_KEY, { kind: 'permissions', all: spec.all, any: spec.any } satisfies AuthzDeclaration);
export const Policy = (name: string) => SetMetadata(POLICY_KEY, name);
export const Destructive = () => SetMetadata(DESTRUCTIVE_KEY, true);
