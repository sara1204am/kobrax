import type { PolicyDefinition } from '../authz.types';
import { clientCreate } from './client-create.policy';
import { creditAssign } from './credit-assign.policy';
import { creditCreate } from './credit-create.policy';
import { creditWriteOff } from './credit-write-off.policy';
import { memberAssignRole } from './member-assign-role.policy';
import { memberInvite } from './member-invite.policy';

const erased = <T>(p: T) => p as unknown as PolicyDefinition<never, unknown>;

/** Registro de políticas. Una política nueva se agrega acá (y a su `@Policy('nombre')` en el handler, si tiene puerta propia). */
export const POLICIES: readonly PolicyDefinition<never, unknown>[] = [
  erased(creditWriteOff),
  erased(clientCreate),
  erased(creditCreate),
  erased(creditAssign),
  erased(memberInvite),
  erased(memberAssignRole),
];

export const POLICY_NAMES: string[] = POLICIES.map((p) => p.name);
