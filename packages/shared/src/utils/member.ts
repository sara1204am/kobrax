import type { Member } from '../types/user.types.js';

/**
 * Nombre para pintar, con el correo de respaldo si el perfil viniera vacío.
 *
 * Es **la única regla del nombre visible de un miembro**, igual que `clientDisplayName()` lo
 * es del deudor: si cada pantalla arma su propio `${firstName} ${lastName}`, la que se olvida
 * del respaldo muestra un espacio en blanco donde debería ir una persona.
 */
export function memberName(m: Pick<Member, 'firstName' | 'lastName' | 'email'>): string {
  const full = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim();
  return full || m.email;
}

/**
 * El estado del miembro, como **código**: la etiqueta la pone cada plataforma (el móvil en
 * español, el panel en los dos idiomas).
 *
 * `pending` gana sobre todo lo demás: un invitado que no aceptó figura activo en su fila de
 * membresía, y mostrarlo como «activo» haría creer que ya está trabajando.
 */
export function memberStatus(m: Pick<Member, 'isActive' | 'userStatus'>): 'pending' | 'inactive' | 'active' {
  if (m.userStatus === 'PENDING') return 'pending';
  return m.isActive ? 'active' : 'inactive';
}
