import { RoleType, officeInScope } from '@kobrax/shared';
import type { AssignScope } from '../../common/office-scope/office-scope';

export type { AssignScope };

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
  | 'IMPORT_REASSIGN'
  | 'BULK_REASSIGN';

/** Un miembro de la cuenta tal como lo necesita la regla: rol, si está activo y su agencia. */
export interface MemberForAssignment {
  userId: string;
  role: string;
  isActive: boolean;
  /** Rutas de las oficinas donde está asignado (F13). Sólo las mira la regla de agencia. */
  officePaths?: string[];
}

/** Los roles que pueden tener créditos a su cargo (D8): el cobrador y el supervisor (que también cobra). */
export const ASSIGNABLE_ROLES: readonly string[] = [RoleType.COLLECTOR, RoleType.SUPERVISOR];

/**
 * A quién se le puede asignar un crédito: a un **cobrador o supervisor activo** de la empresa, o a **uno
 * mismo** — el gerente de una empresa chica que también sale a cobrar no necesita un cobrador ficticio.
 * Un gerente o administrador que no es quien pide no es destino de cartera (no trabajan el crédito en campo).
 */
export function isAssignable(member: MemberForAssignment | undefined, actorId: string | undefined): boolean {
  if (!member || !member.isActive) return false;
  return member.userId === actorId || ASSIGNABLE_ROLES.includes(member.role);
}

/** Los ids que no pasan la regla, sin repetir. Vacío = todos asignables. */
export function notAssignable(userIds: string[], members: MemberForAssignment[], actorId: string | undefined): string[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  return [...new Set(userIds)].filter((id) => !isAssignable(byId.get(id), actorId));
}

/**
 * Hasta dónde reparte quien tiene `assignment:write` (D8, F13):
 *  · `ALL`     — gerente y administrador (`data:scope:all`), o gerente asignado a la raíz: cualquier crédito, a cualquier asignable.
 *  · `OFFICES` — supervisor o gerente regional: sólo créditos cuya oficina cae en el SUBÁRBOL de alguna de sus asignaciones
 *    y sólo a gente asignada dentro de ese subárbol (él incluido). Sin asignaciones no puede repartir nada: falla cerrado.
 * (El tipo vive en `common/office-scope`: es el único lugar que decide el alcance.)
 */

/** Los créditos y destinatarios que se salen del alcance de quien reparte. Vacío = todo dentro (o sin límite). */
export function agencyViolations(
  scope: AssignScope,
  credits: { id: string; officePath: string | null }[],
  assignees: { userId: string; officePaths: string[] }[],
): { creditIds: string[]; userIds: string[] } {
  if (scope.kind === 'ALL') return { creditIds: [], userIds: [] };
  return {
    creditIds: [...new Set(credits.filter((c) => c.officePath === null || !officeInScope(c.officePath, scope.paths)).map((c) => c.id))],
    userIds: [...new Set(assignees.filter((a) => !a.officePaths.some((p) => officeInScope(p, scope.paths))).map((a) => a.userId))],
  };
}

/** Un cambio de responsable ya aplicado. `from: null` = el crédito no tenía; `to: null` = se le quitó. */
export interface AssignmentChange {
  creditId: string;
  from: string | null;
  to: string | null;
  reason: AssignmentReason;
  /** D10: cuántos agendados pendientes pasaron del anterior al nuevo responsable (los pone `apply`). */
  agendaMoved?: number;
}
