import { RoleType, isMobileRole, memberStatus, type Member } from '@kobrax/shared';

/**
 * ¿El rótulo de este rol sale de i18n, o hay que mostrar el nombre crudo?
 *
 * Los rótulos van por i18n y no por `ROLE_LABEL` de `shared`, que está en español: el panel
 * se muestra en dos idiomas. Un rol que el enum no conoce se pinta tal cual en vez de reventar
 * el render.
 */
export function isKnownRole(roleName: string): boolean {
  return (Object.values(RoleType) as string[]).includes(roleName);
}

export interface MemberActions {
  /** Cambiar el rol. */
  changeRole: boolean;
  /** Desactivar: conserva el historial. Es lo que reemplaza a «eliminar» en la web. */
  deactivate: boolean;
  reactivate: boolean;
  /** Eliminar de verdad. **Sólo pendientes** (§6.1 del plan). */
  remove: boolean;
  /** Reenviar la invitación con un código nuevo. Sólo pendientes. */
  resend: boolean;
}

/** Los dos permisos que gobiernan la fila. Son distintos y la API los pide por separado. */
export interface TeamPermissions {
  /** `user:write` — rol, activar/desactivar y eliminar. */
  canWrite: boolean;
  /** `user:invite` — invitar y reenviar. */
  canInvite: boolean;
}

/**
 * Qué se le puede hacer a esta fila.
 *
 * Las guardas duras están en la API — no editarte a vos misma (`cannotEditSelf`), no dejar la
 * cuenta sin el último administrador activo (`lastAdmin`), no borrar a alguien que ya trabajó
 * (`notPending`). Acá sólo se esconde lo que la API va a rechazar igual, para no ofrecer
 * botones que terminan en un error.
 *
 * Las tres reglas que no son obvias:
 * 1. **Eliminar ≠ desactivar.** `DELETE /users/:id` sólo funciona con un `PENDING`, que nunca
 *    registró un caso, un pago ni una gestión. A quien ya trabajó se lo desactiva.
 * 2. **Un rol que la web no puede volver a asignar no se toca.** `GET /roles` devuelve sólo
 *    los tres roles asignables; si esta persona es `MANAGER`, `AUDITOR` o `VIEWER`, cambiarle
 *    el rol sería una puerta de una sola dirección — se sale, no se vuelve. Es la misma
 *    decisión D2 que tomó el móvil, al revés.
 * 3. **Tu propia fila no ofrece nada**: la API lo rechaza y no hay forma de deshacerlo.
 */
export function memberActions(
  member: Member,
  meId: string,
  { canWrite, canInvite }: TeamPermissions,
): MemberActions {
  const self = member.userId === meId;
  const pending = memberStatus(member) === 'pending';
  const base = !self && canWrite;

  return {
    changeRole: base && isMobileRole(member.roleName),
    deactivate: base && !pending && member.isActive,
    reactivate: base && !pending && !member.isActive,
    remove: base && pending,
    // Reenviar pide `user:invite`, no `user:write`: es la misma acción que invitar.
    resend: !self && canInvite && pending,
  };
}
