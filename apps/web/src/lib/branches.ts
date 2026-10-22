import type { Member } from '@kobrax/shared';

/** Una agencia tal como la devuelve `GET /branches`. */
export interface BranchRow {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  address: string | null;
  managerUserId: string | null;
  managerName: string | null;
  active: boolean;
  /** Miembros activos. */
  members: number;
  /** Créditos que la nombran (historial incluido). */
  credits: number;
}

/** Cómo se llama una persona en una lista: su nombre, o el correo si todavía no lo cargó. */
export function memberLabel(m: Pick<Member, 'firstName' | 'lastName' | 'email'>): string {
  return [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email;
}

/** Los miembros activos de una agencia, por nombre. */
export function membersOf(members: Member[], branchId: string): Member[] {
  return members
    .filter((m) => m.isActive && m.branchId === branchId)
    .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)));
}

/**
 * A quién se puede sumar a una agencia: los activos que todavía no están en ella. Los que ya tienen otra agencia
 * se ofrecen igual —moverlos es el punto— pero la pantalla dice de cuál vienen.
 */
export function candidatesFor(members: Member[], branchId: string): Member[] {
  return members
    .filter((m) => m.isActive && m.branchId !== branchId)
    .sort((a, b) => memberLabel(a).localeCompare(memberLabel(b)));
}
