import { Permission } from '@kobrax/shared';
import { allow, deny, type PolicyDefinition } from '../authz.types';
import type { BranchFact, MemberFact } from '../facts-loader';
import { isReservedRole, tierOf, type RoleFact } from '../tier';

export interface MemberAssignRoleInput {
  userId: string;
  /** El rol nuevo (sólo si cambia). */
  roleId?: string;
  /** La oficina nueva (sólo si cambia; `null` la quita). */
  branchId?: string | null;
}

export interface MemberAssignRoleFacts {
  actor: MemberFact | null;
  target: MemberFact | null;
  newRole: RoleFact | null;
  seesAll: boolean;
  newBranch: BranchFact | null;
}

/**
 * `member.assignRole` (H-3, H-13): cambiar el rol o la oficina de una persona. Quien edita debe estar POR ENCIMA de la persona
 * (`tier` del rol actual del destino < el suyo: ni a un par ni a un superior) y el rol nuevo también debe ser de `tier` inferior; nunca un
 * rol reservado. La oficina nueva tiene que caer en el alcance del actor (quitarla sólo quien ve toda la cuenta).
 */
export const memberAssignRole: PolicyDefinition<MemberAssignRoleInput, MemberAssignRoleFacts> = {
  name: 'member.assignRole',
  loadFacts: async (loader, input, tx) => {
    const scope = await loader.assignScope(tx);
    const me = loader.actorId();
    const [members, newRole, newBranch] = await Promise.all([
      loader.members([me, input.userId], tx),
      input.roleId ? loader.role(input.roleId, tx) : Promise.resolve(null),
      input.branchId ? loader.branch(input.branchId, scope, tx) : Promise.resolve(null),
    ]);
    return {
      actor: members.find((m) => m.userId === me) ?? null,
      target: members.find((m) => m.userId === input.userId) ?? null,
      newRole,
      seesAll: scope.kind === 'ALL',
      newBranch,
    };
  },
  decide: (actor, facts, input) => {
    if (!actor.can(Permission.USER_WRITE)) return deny('MEMBER_WRITE_FORBIDDEN', 'No tienes permiso para editar personas');
    if (!facts.actor || !facts.target) return deny('MEMBER_NOT_VISIBLE', 'La persona no existe en tu cuenta', 404);
    const mine = tierOf(facts.actor.role);
    if (tierOf(facts.target.role) >= mine) return deny('MEMBER_TIER_NOT_LOWER', 'Sólo puedes editar a personas con un rol de nivel inferior al tuyo');
    if (input.roleId) {
      if (!facts.newRole) return deny('MEMBER_ROLE_INVALID', 'El rol indicado no existe', 422);
      if (isReservedRole(facts.newRole)) return deny('MEMBER_ROLE_RESERVED', 'Ese rol no se otorga por cambio de rol');
      if (tierOf(facts.newRole) >= mine) return deny('MEMBER_TIER_NOT_LOWER', 'Sólo puedes asignar un rol de nivel inferior al tuyo');
    }
    if (input.branchId) {
      if (!facts.newBranch) return deny('MEMBER_OFFICE_INVALID', 'La oficina indicada no existe', 422);
      if (!facts.newBranch.inScope) return deny('MEMBER_OFFICE_OUT_OF_SCOPE', 'Esa oficina no está dentro de tu alcance');
    } else if (input.branchId === null && !facts.seesAll) {
      return deny('MEMBER_OFFICE_REQUIRED', 'Sólo quien ve toda la cuenta puede dejar a una persona sin oficina', 422);
    }
    return allow();
  },
};
