import type { Reflector } from '@nestjs/core';
import { AUTHZ_KEY, DESTRUCTIVE_KEY, POLICY_KEY, type AuthzDeclaration } from './decorators/authz.decorator';
import { ROLES_ANY_KEY, ROLES_KEY } from './decorators/roles.decorator';

/** El contrato de acceso ya resuelto de un handler. `undefined` = no declaró ninguno. */
export type Access =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'permissions'; all: string[]; any: string[]; policy?: string; destructive: boolean };

/**
 * Resuelve el contrato de un handler. Precedencia (la misma que tenían `@Roles` en handler y en clase):
 * `@Public/@Authenticated/@Authz` del handler → `@Roles/@RolesAny` (handler, si no clase) → `@Public/@Authenticated/@Authz` de la clase.
 * Lo usan el guard y la prueba de cobertura: una sola definición de «qué exige este handler».
 */
export function resolveAccess(reflector: Pick<Reflector, 'get' | 'getAllAndOverride'>, handler: object, cls: object): Access | undefined {
  const own = reflector.get<AuthzDeclaration | undefined>(AUTHZ_KEY, handler as never);
  if (own?.kind === 'public' || own?.kind === 'authenticated') return { kind: own.kind };

  const policy = reflector.get<string | undefined>(POLICY_KEY, handler as never);
  const destructive = reflector.get<boolean | undefined>(DESTRUCTIVE_KEY, handler as never) === true;
  const permissions = (all: string[], any: string[]): Access => ({ kind: 'permissions', all, any, policy, destructive });

  if (own?.kind === 'permissions') return permissions(own.all ?? [], own.any ?? []);

  const targets = [handler, cls] as never[];
  const all = reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets) ?? [];
  const any = reflector.getAllAndOverride<string[] | undefined>(ROLES_ANY_KEY, targets) ?? [];
  if (all.length > 0 || any.length > 0) return permissions(all, any);

  const inherited = reflector.get<AuthzDeclaration | undefined>(AUTHZ_KEY, cls as never);
  if (inherited?.kind === 'public' || inherited?.kind === 'authenticated') return { kind: inherited.kind };
  if (inherited?.kind === 'permissions') return permissions(inherited.all ?? [], inherited.any ?? []);
  return undefined;
}
