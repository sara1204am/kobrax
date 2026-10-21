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
  /** Último inicio de sesión (ISO); `null` si nunca entró. */
  lastLoginAt?: string | null;
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
  /** La marca del negocio activo, para que el panel la pinte sin pedir `account:read`. `null` si no se pudo leer. */
  account?: AccountBrand | null;
}

/** Nombre, teléfono y logo del negocio: lo que ve cualquier miembro (encabezado, variables de las plantillas). */
export interface AccountBrand {
  name: string;
  phone: string | null;
  logoUrl: string | null;
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

/** La ficha de un miembro (`GET /users/:id`): el miembro de la lista más lo que sólo la ficha muestra. */
export type MemberDetail = Member & {
  /** Cuándo se unió a la cuenta (ISO). */
  joinedAt: string;
  /** Oficina asignada. Sólo lectura: no se cambia desde la ficha de otro miembro. */
  branchName: string | null;
};

/** `field` = opera cartera (cobrador, supervisor); `admin` = trabaja en el panel (el resto). */
export type MemberActivityKind = 'field' | 'admin';

export interface MemberActivityEvent {
  /** `tipo:id` de la fila de origen; estable, para no repetir una fila en el borde de dos páginas. */
  id: string;
  type: 'ACTIVITY' | 'PAYMENT' | 'ROUTE' | 'ADMIN';
  at: string;
  /** Tipo de gestión (`CALL`, `VISIT`…) o `entity.action` de la acción administrativa. */
  code: string;
  clientName?: string | null;
}

/** `GET /users/:id/activity?days=`: los números del período. La lista va aparte (`/activity/events`). */
export interface MemberActivity {
  days: number;
  kind: MemberActivityKind;
  /** `field`: activities, payments, routes, activeDays · `admin`: actions, payments, logins, activeDays. */
  metrics: Record<string, number>;
}

/** Una página de una lista que crece sin tope. `nextCursor` (un instante ISO) es `null` en la última. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Una fila de `GET /users/:id/connections` (paginado). Hoy sólo hay accesos exitosos; la IP viene enmascarada. */
export interface MemberConnection {
  id: string;
  loginAt: string;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  result: 'SUCCESS';
}

/** `GET /users/:id/audit`. El detalle son datos para armar la frase, no el `before`/`after` crudo. */
export interface MemberAuditEvent {
  id: string;
  at: string;
  event: string;
  detail: Record<string, string | number | null>;
  actorName: string | null;
}
