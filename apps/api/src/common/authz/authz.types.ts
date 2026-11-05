import type { FactsLoader } from './facts-loader';

/** Quién actúa: lo mínimo que una política necesita saber de la sesión. */
export interface Actor {
  userId?: string;
  accountId: string;
  can: (permission: string) => boolean;
}

export type Decision = { allow: true } | { allow: false; code: string; message: string; status?: 403 | 404 };

export const allow = (): Decision => ({ allow: true });
export const deny = (code: string, message: string, status: 403 | 404 = 403): Decision => ({ allow: false, code, message, status });

/**
 * Una política contextual (F14 · F3, ADR-F14-03): función PURA `(actor, hechos, entrada) → Allow | Deny(código)`.
 * Si necesita datos de la DB los pide a `FactsLoader` en `loadFacts`; `decide` nunca toca Prisma.
 */
export interface PolicyDefinition<I = unknown, F = undefined> {
  name: string;
  loadFacts?: (loader: FactsLoader, input: I) => Promise<F>;
  decide: (actor: Actor, facts: F, input: I) => Decision;
}
