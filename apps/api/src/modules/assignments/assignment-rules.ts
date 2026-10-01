import { RoleType } from '@kobrax/shared';

/**
 * Por qué se asignó. Viaja en la auditoría, no en la base: `credit_assignments` guarda quién, a
 * quién y cuándo; el motivo es para leer el historial, no para decidir nada.
 *
 * - `*_OWN`: la deriva el sistema («lo tuyo es tuyo») — el cobrador que importa su cartera o da de
 *   alta un préstamo. No exige `assignment:write` porque nadie elige sobre qué crédito.
 * - El resto: una persona con `assignment:write` eligió.
 */
export type AssignmentReason =
  | 'MANUAL'
  | 'CREATE_OWN'
  | 'CREATE_MANUAL'
  | 'IMPORT_OWN'
  | 'IMPORT_SUGGESTED'
  | 'IMPORT_CHOSEN'
  | 'IMPORT_REASSIGN';

/** Un miembro de la cuenta tal como lo necesita la regla: rol y si está activo. */
export interface MemberForAssignment {
  userId: string;
  role: string;
  isActive: boolean;
}

/**
 * P3 · A quién se le puede asignar un crédito: a un **cobrador activo** de la empresa, o a **uno
 * mismo** — el gerente de una empresa chica que también sale a cobrar no necesita un cobrador
 * ficticio. Un supervisor o gerente que no cobra no es destino de cartera.
 */
export function isAssignable(member: MemberForAssignment | undefined, actorId: string | undefined): boolean {
  if (!member || !member.isActive) return false;
  return member.userId === actorId || member.role === RoleType.COLLECTOR;
}

/** Los ids que no pasan la regla, sin repetir. Vacío = todos asignables. */
export function notAssignable(userIds: string[], members: MemberForAssignment[], actorId: string | undefined): string[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  return [...new Set(userIds)].filter((id) => !isAssignable(byId.get(id), actorId));
}

/** Un cambio de responsable ya aplicado. `from: null` = el crédito no tenía; `to: null` = se le quitó. */
export interface AssignmentChange {
  creditId: string;
  from: string | null;
  to: string | null;
  reason: AssignmentReason;
}
