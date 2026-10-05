/**
 * Miembros del tenant y roles asignables: el contrato de `/users` y `/roles`, que el móvil y
 * la web consumen igual.
 */

/** Una fila de `GET /users`. El servidor manda el nombre sin concatenar y el rol crudo. */
export interface Member {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  photoUrl: string | null;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  isActive: boolean;
  /** `PENDING` = invitado que todavía no aceptó. */
  userStatus: string;
}

/** El alta devuelve además el código, **una sola vez**, para poder compartirlo. */
export type InvitedMember = Member & { invitationCode: string };

/** Una fila de `GET /roles`. Ojo: el servidor sólo devuelve los roles asignables. */
export interface AssignableRole {
  id: string;
  name: string;
  level: number;
}

/** Lo que devuelve `GET /auth/me`: la identidad de la sesión activa. */
export interface MeInfo {
  userId: string;
  email: string;
  profile: { firstName: string; lastName: string; photoUrl?: string } | null;
  accountId: string;
  role: string;
  permissions: string[];
  mfaEnabled?: boolean;
  requiresPasswordChange?: boolean;
}

/**
 * Alguien a quien se le puede asignar un crédito (P3): un cobrador activo, o quien está asignando.
 * Lo arma el servidor (`GET /assignments/assignees`) con la misma regla que valida al guardar, así
 * que un selector armado con esto no ofrece a nadie que después rebote.
 */
export interface Assignee {
  userId: string;
  name: string;
  roleName: string;
  /** Quien pidió la lista: la pantalla lo muestra como «Yo» y arriba de todo. */
  isMe: boolean;
}
