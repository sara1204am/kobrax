import { Permission } from '@kobrax/shared';
import { allow, deny, type PolicyDefinition } from '../authz.types';
import type { BranchFact } from '../facts-loader';

export interface ClientCreateInput {
  /** La oficina que pidió el actor (se valida contra su alcance; nunca se confía en ella). */
  branchId?: string | null;
}

export interface ClientCreateFacts {
  /** La única oficina hoja de la cuenta, si hay una sola (cuenta individual o de una oficina). */
  soleLeaf: string | null;
  /** La oficina de la única asignación vigente del actor. */
  actorOffice: string | null;
  /** La oficina pedida con su ruta y alcance; `null` si no se pidió o no existe. */
  requested: BranchFact | null;
  /** La oficina del actor (para saber si es la raíz). */
  actorOfficeFact: BranchFact | null;
}

/**
 * `client.create` (H-7, C.8): resuelve SÓLO la oficina de registro del cliente (a nombre de quién va el crédito se decide al crearlo).
 *  · cuenta de una sola oficina → esa oficina (el administrador o cobrador independiente crea sin pedir nada);
 *  · si no: la que pidió quien tiene `assignment:write` y esté en su alcance, o la oficina única del actor;
 *  · nunca la raíz de una cuenta con varias oficinas (`CLIENT_CREATE_AT_ROOT`) ni una oficina sin resolver.
 * Devuelve `{ registeredBranchId }`.
 */
export const clientCreate: PolicyDefinition<ClientCreateInput, ClientCreateFacts> = {
  name: 'client.create',
  loadFacts: async (loader, input, tx) => {
    const scope = await loader.assignScope(tx);
    const [soleLeaf, actorOffice, requested] = await Promise.all([
      loader.soleLeafOffice(tx),
      loader.soleOfficeOf(loader.actorId(), tx),
      input.branchId ? loader.branch(input.branchId, scope, tx) : Promise.resolve(null),
    ]);
    const actorOfficeFact = actorOffice ? await loader.branch(actorOffice, scope, tx) : null;
    return { soleLeaf, actorOffice, requested, actorOfficeFact };
  },
  decide: (actor, facts, input) => {
    if (!actor.can(Permission.CLIENT_CREATE)) return deny('CLIENT_CREATE_FORBIDDEN', 'No tienes permiso para crear clientes');
    if (facts.soleLeaf) return allow({ registeredBranchId: facts.soleLeaf });

    if (input.branchId) {
      const b = facts.requested;
      if (!b) return deny('CLIENT_BRANCH_INVALID', 'La oficina indicada no existe', 422);
      if (!b.active) return deny('CLIENT_BRANCH_INVALID', 'La oficina indicada está inactiva', 422);
      // Quien no reparte (el cobrador) sólo registra en su propia oficina.
      const allowedToChoose = actor.can(Permission.ASSIGNMENT_WRITE) || b.id === facts.actorOffice;
      if (!allowedToChoose || !b.inScope) return deny('CLIENT_BRANCH_OUT_OF_SCOPE', 'No puedes registrar clientes en esa oficina');
      if (b.isRoot) return deny('CLIENT_CREATE_AT_ROOT', 'Elige una oficina: la central no registra clientes', 422);
      return allow({ registeredBranchId: b.id });
    }

    if (!facts.actorOffice) return deny('CLIENT_BRANCH_UNRESOLVED', 'No se pudo determinar la oficina de registro: indica una', 422);
    if (facts.actorOfficeFact?.isRoot) return deny('CLIENT_CREATE_AT_ROOT', 'Elige una oficina: la central no registra clientes', 422);
    return allow({ registeredBranchId: facts.actorOffice });
  },
};
