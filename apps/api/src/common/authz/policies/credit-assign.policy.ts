import { allow, deny, type PolicyDefinition } from '../authz.types';
import type { MemberFact } from '../facts-loader';
import { strictlyBelow, tierOf } from '../tier';

export interface CreditAssignInput {
  /** Los destinos (responsables) de la asignación. */
  targetIds: string[];
}

export interface CreditAssignFacts {
  actor: MemberFact | null;
  targets: MemberFact[];
}

/**
 * `credit.assign` (R-13, H-8): a quién puede destinar un crédito quien lo asigna, por la relación organizacional real.
 *  · el destino es del mismo tenant y está activo (los datos vienen filtrados por la cuenta);
 *  · uno mismo siempre;
 *  · `tier` del destino ≤ `tier` del actor;
 *  · si el `tier` es IGUAL (supervisor → supervisor): sólo si TODAS las oficinas del destino cuelgan estrictamente de alguna oficina del
 *    actor — el par de la misma oficina sólo lo asigna un gerente o administrador (de `tier` mayor).
 * La pertenencia al alcance de oficinas (agencia/subárbol) y los roles asignables los siguen verificando `assertAssignable`/`assertAgency`.
 */
export const creditAssign: PolicyDefinition<CreditAssignInput, CreditAssignFacts> = {
  name: 'credit.assign',
  loadFacts: async (loader, input, tx) => {
    const me = loader.actorId();
    const members = await loader.members([me, ...input.targetIds], tx);
    return { actor: members.find((m) => m.userId === me) ?? null, targets: members.filter((m) => m.userId !== me) };
  },
  decide: (actor, facts, input) => {
    const wanted = [...new Set(input.targetIds.filter((id) => id !== actor.userId))];
    if (wanted.length === 0) return allow();
    const me = facts.actor;
    if (!me) return deny('CREDIT_ASSIGN_FORBIDDEN', 'No puedes asignar créditos en esta cuenta');
    const mine = tierOf(me.role);
    const bad: string[] = [];
    for (const id of wanted) {
      const t = facts.targets.find((m) => m.userId === id);
      if (!t || !t.active) {
        bad.push(id);
        continue;
      }
      const theirs = tierOf(t.role);
      const belowMe = t.paths.length > 0 && t.paths.every((p) => strictlyBelow(p, me.paths));
      if (theirs > mine || (theirs === mine && !belowMe)) bad.push(id);
    }
    return bad.length === 0
      ? allow()
      : deny('CREDIT_ASSIGN_TIER', 'No puedes asignar créditos a una persona de tu mismo nivel en tu oficina ni a una de nivel superior');
  },
};
