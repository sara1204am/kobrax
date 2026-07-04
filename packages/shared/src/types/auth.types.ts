/** Payload firmado dentro del JWT de acceso. */
export interface JwtPayload {
  sub: string; // userId
  accountId: string; // tenant activo
  roleId: string; // rol en este tenant
  permissions: string[]; // lista plana de permisos efectivos
  iat: number;
  exp: number;
}

/** Usuario autenticado tal como lo recibe la capa de negocio (request.user). */
export interface AuthUser {
  userId: string;
  accountId: string;
  roleId: string;
  branchId?: string;
  permissions: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Propósito de un token intermedio (pre-auth) entre pasos del login. */
export type PreAuthPurpose = 'mfa' | 'select_account' | 'mfa_enroll';

/** Payload del pre-auth token (5 min, single-purpose, sin permisos ni accountId). */
export interface PreAuthPayload {
  sub: string; // userId
  purpose: PreAuthPurpose;
  mfaVerified?: boolean;
  iat: number;
  exp: number;
}

/**
 * Paso actual del flujo de login.
 * `mfa_setup` (F2b): rol crítico sin MFA → enroll obligatorio antes de continuar.
 */
export type LoginStep = 'mfa' | 'mfa_setup' | 'select_account' | 'done';

/** Empresa disponible para el usuario en el selector multi-tenant. */
export interface AuthAccountOption {
  id: string;
  name: string;
  logoUrl?: string;
  role: string;
  status: string;
}

/** Respuesta del login / pasos intermedios. */
export interface LoginResult {
  step: LoginStep;
  preAuthToken?: string;
  accounts?: AuthAccountOption[];
  accessToken?: string;
  refreshToken?: string;
}

/** Sesión activa del usuario (para la pantalla de seguridad — F2b). */
export interface SessionInfo {
  id: string;
  accountName: string;
  ip?: string;
  deviceName?: string;
  deviceType?: string;
  os?: string;
  city?: string;
  country?: string;
  loginAt?: string;
  lastSeenAt?: string;
  /** True si es la sesión desde la que se hace la consulta. */
  isCurrent: boolean;
}
