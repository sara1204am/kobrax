import { Permission } from '@kobrax/shared';
import { allow, deny, type PolicyDefinition } from '../authz.types';
import type { BranchFact, MemberFact } from '../facts-loader';
import { isReservedRole, tierOf, type RoleFact } from '../tier';

export interface MemberInviteInput {
  roleId: string;
  branchId?: string | null;
}

export interface MemberInviteFacts {
  actor: MemberFact | null;
  role: RoleFact | null;
  /** `true` si el actor ve toda la cuenta (ALL). */
  seesAll: boolean;
  branch: BranchFact | null;
}

/**
 * `member.invite` (H-3, H-13): invitar a una persona. Rol destino de `tier` ESTRICTAMENTE inferior al del actor (un gerente no invita
 * a otro gerente), oficina destino dentro del alcance del actor, y nunca un rol reservado (el ACCOUNT_ADMIN lo asigna sólo la plataforma).
 * Sin oficina sólo invita quien ve toda la cuenta (una persona sin oficina sería invisible para un gerente regional).
 */
export const memberInvite: PolicyDefinition<MemberInviteInput, MemberInviteFacts> = {
  name: 'member.invite',
  loadFacts: async (loader, input, tx) => {
    const scope = await loader.assignScope(tx);
    const [members, role, branch] = await Promise.all([
      loader.members([loader.actorId()], tx),
      loader.role(input.roleId, tx),
      input.branchId ? loader.branch(input.branchId, scope, tx) : Promise.resolve(null),
    ]);
    return { actor: members[0] ?? null, role, seesAll: scope.kind === 'ALL', branch };
  },
  decide: (actor, facts, input) => {
    if (!actor.can(Permission.USER_INVITE)) return deny('MEMBER_INVITE_FORBIDDEN', 'No tienes permiso para invitar personas');
    if (!facts.role) return deny('MEMBER_ROLE_INVALID', 'El rol indicado no existe', 422);
    if (isReservedRole(facts.role)) return deny('MEMBER_ROLE_RESERVED', 'Ese rol no se otorga por invitación');
    if (!facts.actor || tierOf(facts.role) >= tierOf(facts.actor.role)) {
      return deny('MEMBER_TIER_NOT_LOWER', 'Sólo puedes invitar a personas con un rol de nivel inferior al tuyo');
    }
    if (input.branchId) {
      if (!facts.branch) return deny('MEMBER_OFFICE_INVALID', 'La oficina indicada no existe', 422);
      if (!facts.branch.inScope) return deny('MEMBER_OFFICE_OUT_OF_SCOPE', 'Esa oficina no está dentro de tu alcance');
    } else if (!facts.seesAll) {
      return deny('MEMBER_OFFICE_REQUIRED', 'Indica la oficina de la persona que invitas', 422);
    }
    return allow();
  },
};
