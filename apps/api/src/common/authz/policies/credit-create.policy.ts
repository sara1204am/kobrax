import { Permission } from '@kobrax/shared';
import { allow, deny, type PolicyDefinition } from '../authz.types';

export interface CreditCreateInput {
  /** El responsable que pidió el actor; vacío = decide la política. */
  assignedManagerId?: string | null;
}

/**
 * `credit.create` (H-7): «crear a su nombre» o «asignar a otra persona». Pura (sin hechos de la DB):
 *  · requiere `credit:create`;
 *  · elegir a OTRA persona exige `assignment:write` (y ese destino pasa además por `credit.assign`);
 *  · sin elegir: quien puede repartir deja el crédito sin responsable (lo reparte después); quien no, queda como responsable.
 * Devuelve `{ responsibleId?, needsAssign }`.
 */
export const creditCreate: PolicyDefinition<CreditCreateInput, undefined> = {
  name: 'credit.create',
  decide: (actor, _facts, input) => {
    if (!actor.can(Permission.CREDIT_CREATE)) return deny('CREDIT_CREATE_FORBIDDEN', 'No tienes permiso para crear créditos');
    const me = actor.userId;
    const chosen = input.assignedManagerId ?? undefined;
    const canAssign = actor.can(Permission.ASSIGNMENT_WRITE);
    if (chosen && chosen !== me) {
      if (!canAssign) return deny('ASSIGNMENT_FORBIDDEN', 'No tenés permiso para cambiar el responsable de un crédito');
      return allow({ responsibleId: chosen, needsAssign: true });
    }
    return allow({ responsibleId: chosen ?? (canAssign ? undefined : me), needsAssign: false });
  },
};
