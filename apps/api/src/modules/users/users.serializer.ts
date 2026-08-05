import type { Profile, Role, User, UserAccount } from '@prisma/client';

export type MemberRow = UserAccount & {
  user: User & { profile: Profile | null };
  role: Role;
};

/**
 * Miembro del tenant. Dos cosas van sueltas a propósito:
 * - el nombre, sin concatenar (igual que `GET /auth/me`): quien pinta compone;
 * - el rol como `roleName`, sin etiqueta. La etiqueta es presentación y sale de
 *   `ROLE_LABEL` (`packages/shared`) en el cliente. Mandarla acá sería una segunda
 *   fuente de la misma cadena.
 */
export function serializeMember(m: MemberRow) {
  return {
    userId: m.userId,
    email: m.user.email,
    firstName: m.user.profile?.firstName ?? null,
    lastName: m.user.profile?.lastName ?? null,
    phone: m.user.profile?.phone ?? null,
    photoUrl: m.user.profile?.photoUrl ?? null,
    roleId: m.roleId,
    roleName: m.role.name,
    isOwner: m.isOwner,
    isActive: m.isActive,
    userStatus: m.user.status,
  };
}

export function serializeProfile(user: User & { profile: Profile | null }) {
  return {
    userId: user.id,
    email: user.email,
    firstName: user.profile?.firstName ?? null,
    lastName: user.profile?.lastName ?? null,
    phone: user.profile?.phone ?? null,
    photoUrl: user.profile?.photoUrl ?? null,
  };
}

export function serializeRole(role: Role) {
  return { id: role.id, name: role.name, level: role.level };
}
