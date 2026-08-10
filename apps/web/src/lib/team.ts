import { isMobileRole, memberStatus, type Member } from '@kobrax/shared';

export interface MemberActions {
  /** Cambiar el rol. */
  changeRole: boolean;
  /** Desactivar: conserva el historial. Es lo que reemplaza a «eliminar» en la web. */
  deactivate: boolean;
  reactivate: boolean;
  /** Eliminar de verdad. **Sólo pendientes** (§6.1 del plan). */
  remove: boolean;
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
export function memberActions(member: Member, meId: string, canWrite: boolean): MemberActions {
  const self = member.userId === meId;
  const pending = memberStatus(member) === 'pending';
  const base = canWrite && !self;

  return {
    changeRole: base && isMobileRole(member.roleName),
    deactivate: base && !pending && member.isActive,
    reactivate: base && !pending && !member.isActive,
    remove: base && pending,
  };
}
