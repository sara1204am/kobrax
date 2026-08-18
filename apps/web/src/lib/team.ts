import { RoleType, isMobileRole, memberName, memberStatus, type Member } from '@kobrax/shared';
import { matchesText } from './portfolio';
import { PAGE_SIZES } from './table-prefs';

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

/** Lo que la pantalla de Equipo sabe leer de la URL. Las claves son las que escribe el `DataTable`. */
export interface TeamParams {
  q?: string;
  role?: string;
  status?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

export const DEFAULT_PAGE_SIZE = 25;

export function teamLimit(params: TeamParams): number {
  return PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : DEFAULT_PAGE_SIZE;
}

/** Las columnas que esta tabla sabe ordenar. El estado no: alfabético no dice nada útil. */
const SORTS = ['name', 'role'] as const;

export function hasTeamFilters(params: TeamParams): boolean {
  return Boolean(params.q?.trim() || params.role || params.status);
}

/**
 * Filtrar, ordenar y paginar el equipo **en memoria**.
 *
 * 🔴 `GET /users` no hace nada de eso: devuelve el equipo entero, que por el techo del plan son
 * pocas filas. Es la única lista del panel que se resuelve acá — las demás lo delegan al servidor
 * porque ordenan sobre agregados que no viajan en la página. Igual el estado vive en la URL, así
 * que la vista se comparte por link y «atrás» funciona como en las otras.
 *
 * Es pura: la pantalla le pasa lo que trajo la API y lo que hay en la URL, y recibe la página y su
 * `meta`. Por eso se puede probar sin red y sin DOM.
 */
export function teamView(
  members: Member[],
  params: TeamParams,
): { rows: Member[]; meta: { total: number; page: number; limit: number; pages: number } } {
  const q = params.q?.trim() ?? '';
  let found = members;
  if (q) found = found.filter((m) => matchesText(memberName(m), q) || matchesText(m.email, q));
  if (params.role) found = found.filter((m) => m.roleName === params.role);
  if (params.status) found = found.filter((m) => memberStatus(m) === params.status);

  if ((SORTS as readonly string[]).includes(params.sort ?? '')) {
    const factor = params.dir === 'desc' ? -1 : 1;
    const key = (m: Member) => (params.sort === 'role' ? m.roleName : memberName(m));
    found = [...found].sort((a, b) => key(a).localeCompare(key(b)) * factor);
  }

  const limit = teamLimit(params);
  const pages = Math.max(1, Math.ceil(found.length / limit));
  // Filtrar puede dejar menos páginas de las que había: quedarse en la 5 mostraría una tabla vacía
  // con la paginación diciendo que hay filas.
  const page = Math.min(Math.max(1, Number(params.page) || 1), pages);

  return {
    rows: found.slice((page - 1) * limit, page * limit),
    meta: { total: found.length, page, limit, pages },
  };
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
