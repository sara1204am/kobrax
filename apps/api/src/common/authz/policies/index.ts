import type { PolicyDefinition } from '../authz.types';
import { creditWriteOff } from './credit-write-off.policy';

/** Registro de políticas. Una política nueva se agrega acá (y a su `@Policy('nombre')` en el handler). */
export const POLICIES: readonly PolicyDefinition<never, unknown>[] = [creditWriteOff as unknown as PolicyDefinition<never, unknown>];

export const POLICY_NAMES: string[] = POLICIES.map((p) => p.name);
