import { Permission } from '@kobrax/shared';
import { allow, deny, type PolicyDefinition } from '../authz.types';

/**
 * `credit.writeOff` — castigar un crédito o revertir el castigo. Gerente y administrador: escritura de créditos **y** alcance total o
 * de subárbol (F13: el gerente regional). El supervisor (agencia) y el cobrador no. Que el crédito esté dentro del subárbol lo decide
 * el servicio (`assertInScope`: 404 igual que la ficha de mora). Es la primera política del registro; F2 añade las demás.
 */
export const creditWriteOff: PolicyDefinition<void, undefined> = {
  name: 'credit.writeOff',
  decide: (actor) => {
    const has = actor.can;
    const wide = has(Permission.DATA_SCOPE_ALL) || has(Permission.DATA_SCOPE_SUBTREE);
    return has(Permission.CREDIT_WRITE) && wide
      ? allow()
      : deny('WRITE_OFF_FORBIDDEN', 'Sólo un gerente o un administrador puede castigar un crédito o revertir el castigo');
  },
};
