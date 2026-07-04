import { Permission, ROLE_PERMISSIONS, type RoleType } from '@kobrax/shared';

/** Identidad mínima que el gateway deriva del access token para enrutar al socket. */
export interface SocketIdentity {
  userId: string;
  accountId: string;
  permissions: string[];
}

/** Permiso que distingue a quien **supervisa el campo** (recibe el feed en vivo y el mapa). */
export const SUPERVISION_PERMISSION: string = Permission.ROUTE_ASSIGN;

/** Intervalo mínimo entre dos pings de ubicación aceptados por socket (anti-saturación, RNF-04). */
export const LOCATION_THROTTLE_MS = 5_000;

export const tenantRoom = (accountId: string): string => `tenant:${accountId}`;
export const userRoom = (userId: string): string => `user:${userId}`;
export const supervisorsRoom = (accountId: string): string => `tenant:${accountId}:supervisors`;

/**
 * Roles con capacidad de supervisión (los que reciben notificaciones de feed:
 * casos/pagos/rutas). Derivado de `ROLE_PERMISSIONS`: cualquier rol que pueda
 * asignar rutas supervisa el campo. Fuente única → no se desincroniza del RBAC.
 */
export const SUPERVISORY_ROLES: string[] = (
  Object.entries(ROLE_PERMISSIONS) as [RoleType, Permission[]][]
)
  .filter(([, perms]) => perms.includes(Permission.ROUTE_ASSIGN))
  .map(([role]) => role);

/**
 * Rooms a las que se une un socket — **derivadas server-side** desde su identidad,
 * nunca declaradas por el cliente (M3, aislamiento de tenant). Un supervisor además
 * entra a la room de supervisores de su tenant.
 */
export function deriveRooms(identity: SocketIdentity): string[] {
  const rooms = [tenantRoom(identity.accountId), userRoom(identity.userId)];
  if (identity.permissions.includes(SUPERVISION_PERMISSION)) {
    rooms.push(supervisorsRoom(identity.accountId));
  }
  return rooms;
}

/** Solo los cobradores (route:execute) pueden emitir su ubicación. */
export function canSendLocation(identity: SocketIdentity): boolean {
  return identity.permissions.includes(Permission.ROUTE_EXECUTE);
}

/** GPS válido (lat ∈ [-90,90], lng ∈ [-180,180], finitos). */
export function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Decide si aceptar un ping de ubicación dado el instante del último aceptado.
 * `true` si nunca hubo uno o si pasó el intervalo mínimo.
 */
export function shouldAcceptLocation(
  lastAcceptedAt: number | undefined,
  now: number,
  minIntervalMs: number = LOCATION_THROTTLE_MS,
): boolean {
  return lastAcceptedAt === undefined || now - lastAcceptedAt >= minIntervalMs;
}
