import type { PrismaClient } from '@prisma/client';
import type { FactsLoader } from './facts-loader';

/** Quién actúa: lo mínimo que una política necesita saber de la sesión. */
export interface Actor {
  userId?: string;
  accountId: string;
  can: (permission: string) => boolean;
}

/** `allow` puede traer datos resueltos por la política (p. ej. la oficina de registro); `deny` lleva el código del dominio. */
export type Decision = { allow: true; data?: Record<string, unknown> } | { allow: false; code: string; message: string; status?: 403 | 404 | 422 };

export const allow = (data?: Record<string, unknown>): Decision => (data ? { allow: true, data } : { allow: true });
export const deny = (code: string, message: string, status: 403 | 404 | 422 = 403): Decision => ({ allow: false, code, message, status });

/**
 * Una política contextual (F14 · F3, ADR-F14-03): función PURA `(actor, hechos, entrada) → Allow | Deny(código)`.
 * Si necesita datos de la DB los pide a `FactsLoader` en `loadFacts`; `decide` nunca toca Prisma.
 */
export interface PolicyDefinition<I = unknown, F = undefined> {
  name: string;
  /** `tx`: la transacción del servicio que pregunta, para leer los hechos con la misma foto (opcional). */
  loadFacts?: (loader: FactsLoader, input: I, tx?: PrismaClient) => Promise<F>;
  decide: (actor: Actor, facts: F, input: I) => Decision;
}
