/**
 * La marca que deja un reemplazo temporal en lo agendado que traspasa (F4/08 · D8-a). Vive en
 * `agenda_items.details` —sin tocar el schema— y dice de quién era el ítem y por cuál asignación se movió:
 * es lo que permite devolverlo al vencer, y sólo lo que lleva la marca (lo que el reemplazo creó o hizo no).
 */
export const HANDOFF_FROM_KEY = 'handoffFromUserId';
export const HANDOFF_ASSIGNMENT_KEY = 'handoffAssignmentId';

type Details = Record<string, unknown>;

function asObject(details: unknown): Details {
  return details && typeof details === 'object' && !Array.isArray(details) ? { ...(details as Details) } : {};
}

/** El `details` del ítem con la marca de traspaso puesta. Conserva el resto de los campos del tipo. */
export function withHandoff(details: unknown, fromUserId: string, assignmentId: string): Details {
  return { ...asObject(details), [HANDOFF_FROM_KEY]: fromUserId, [HANDOFF_ASSIGNMENT_KEY]: assignmentId };
}

/** El `details` sin la marca. */
export function withoutHandoff(details: unknown): Details {
  const d = asObject(details);
  delete d[HANDOFF_FROM_KEY];
  delete d[HANDOFF_ASSIGNMENT_KEY];
  return d;
}

/** ¿El ítem se traspasó por esta asignación? */
export function isHandedOffBy(details: unknown, assignmentId: string): boolean {
  return asObject(details)[HANDOFF_ASSIGNMENT_KEY] === assignmentId;
}

/** De quién era el ítem antes del traspaso, si lo hubo. */
export function handoffFrom(details: unknown): string | null {
  const v = asObject(details)[HANDOFF_FROM_KEY];
  return typeof v === 'string' ? v : null;
}
