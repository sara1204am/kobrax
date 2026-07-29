import type { Profile, Role, User, UserAccount } from '@prisma/client';
import { ROLE_LABEL, type RoleType } from '@kobrax/shared';

export type MemberRow = UserAccount & {
  user: User & { profile: Profile | null };
  role: Role;
};

/**
 * Miembro del tenant. Los campos de nombre van sueltos (igual que `GET /auth/me`),
 * no concatenados: quien pinta compone.
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
    roleLabel: ROLE_LABEL[m.role.name as RoleType] ?? m.role.name,
    isOwner: m.isOwner,
    isActive: m.isActive,
    userStatus: m.user.status,
    lastLoginAt: m.user.lastLoginAt,
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
  return {
    id: role.id,
    name: role.name,
    label: ROLE_LABEL[role.name as RoleType] ?? role.name,
    level: role.level,
  };
}
