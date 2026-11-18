import { PrivacyRequestStatus as S } from '@kobrax/shared';

/** Estados en los que la solicitud sigue abierta (no es final). */
export const OPEN_STATUSES: readonly S[] = [S.RECEIVED, S.IN_REVIEW, S.NEEDS_INFO, S.APPROVED];

/** Estados finales: ya no cambian. */
export const isTerminal = (s: S): boolean => s === S.REJECTED || s === S.COMPLETED;

/**
 * Máquina de estados del seguimiento. Una solicitud solo avanza por estos caminos:
 *   RECEIVED   → IN_REVIEW | REJECTED
 *   IN_REVIEW  → NEEDS_INFO | APPROVED | REJECTED
 *   NEEDS_INFO → IN_REVIEW | REJECTED
 *   APPROVED   → COMPLETED
 * `REJECTED` y `COMPLETED` son finales. No se puede saltar de «Recibida» a «Completada»: cada paso queda registrado como evento.
 */
const NEXT: Record<S, readonly S[]> = {
  [S.RECEIVED]: [S.IN_REVIEW, S.REJECTED],
  [S.IN_REVIEW]: [S.NEEDS_INFO, S.APPROVED, S.REJECTED],
  [S.NEEDS_INFO]: [S.IN_REVIEW, S.REJECTED],
  [S.APPROVED]: [S.COMPLETED],
  [S.REJECTED]: [],
  [S.COMPLETED]: [],
};

export const allowedNext = (from: S): readonly S[] => NEXT[from];
export const canTransition = (from: S, to: S): boolean => NEXT[from].includes(to);

const MIN_REASON = 5;

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: 'INVALID_TRANSITION' | 'REASON_REQUIRED' | 'NOTE_REQUIRED' };

/**
 * ¿Se puede pasar de `from` a `to` con esto? Rechazar exige una **justificación** (no se rechaza en silencio) y pedir información exige
 * decir qué información falta (si no, la persona no sabría qué aportar).
 */
export function checkTransition(from: S, to: S, input: { note?: string | null; rejectionReason?: string | null }): TransitionCheck {
  if (!canTransition(from, to)) return { ok: false, code: 'INVALID_TRANSITION' };
  if (to === S.REJECTED && (input.rejectionReason ?? '').trim().length < MIN_REASON) return { ok: false, code: 'REASON_REQUIRED' };
  if (to === S.NEEDS_INFO && (input.note ?? '').trim().length < MIN_REASON) return { ok: false, code: 'NOTE_REQUIRED' };
  return { ok: true };
}

/** Tope de solicitudes abiertas por persona: evita inundar el canal (y es un límite de abuso, no de derechos: cerrar una libera cupo). */
export const MAX_OPEN_PER_USER = 10;

/** Tope de pedidos abiertos por correo en el formulario público (no hay cuenta a la que atarlo): frena la inundación sin impedir un reclamo legítimo. */
export const MAX_OPEN_PER_CONTACT = 5;
