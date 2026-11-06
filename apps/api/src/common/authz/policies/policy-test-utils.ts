import type { Actor, Decision } from '../authz.types';

/** Un actor de prueba con los permisos dados. */
export const actorWith = (perms: string[], userId = 'me'): Actor => ({ userId, accountId: 'acc', can: (p) => perms.includes(p) });

/** Código de un `deny` (o `undefined` si se permitió). */
export const codeOf = (d: Decision): string | undefined => (d.allow ? undefined : d.code);

export const branch = (id: string, over: Partial<{ path: string; isRoot: boolean; active: boolean; inScope: boolean }> = {}) => ({
  id,
  path: over.path ?? `/${id}/`,
  isRoot: over.isRoot ?? false,
  active: over.active ?? true,
  inScope: over.inScope ?? true,
});

export const member = (userId: string, roleName: string, level: number, paths: string[], active = true) => ({
  userId,
  active,
  role: { name: roleName, level },
  paths,
});
