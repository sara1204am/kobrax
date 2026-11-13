import type { Member } from '@kobrax/shared';

/** Cómo se llama una persona en una lista: su nombre, o el correo si todavía no lo cargó. */
export function memberLabel(m: Pick<Member, 'firstName' | 'lastName' | 'email'>): string {
  return [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email;
}
