import { Permission } from '../enums/permission.enum.js';

/**
 * F14 · F5 (ADR-F14-08, H-11) — la plataforma de Kobrax (la persona de infraestructura), separada de las empresas.
 *
 * 🔴 Estos permisos viven AQUÍ y no en `Permission`: el mapa de roles de empresa da `Object.values(Permission)` a los administradores, así que
 * cualquier permiso de plataforma agregado al enum de empresa se le concedería a un administrador. Ningún rol de empresa los tiene, y ninguna ruta de
 * empresa los acepta.
 */
export enum PlatformPermission {
  ACCOUNTS_READ = 'platform:accounts:read',
  ROLES_WRITE = 'platform:roles:write',
  ROLES_ROLLOUT = 'platform:roles:rollout',
  SUPPORT_OPEN = 'platform:support:open',
  AUDIT_READ = 'platform:audit:read',
}

export const PLATFORM_PERMISSIONS: readonly string[] = Object.values(PlatformPermission);

/** Vida máxima de una sesión de soporte (minutos). También es una restricción de la base. */
export const SUPPORT_MAX_TTL_MINUTES = 240;

/** Escritura sensible: sólo con el consentimiento del administrador de la cuenta y con `SUPPORT_WRITE_ENABLED` encendido. */
export const SUPPORT_SENSITIVE_PERMISSIONS: readonly string[] = [Permission.USER_WRITE, Permission.ROLE_WRITE, Permission.ACCOUNT_WRITE, Permission.OFFICE_WRITE];

/** Lo máximo que puede pedir una sesión de soporte: lectura de todo lo de la cuenta (con alcance de toda la cuenta) + la escritura sensible consentida. */
export function supportMaxPermissions(): string[] {
  const reads = Object.values(Permission).filter((p) => p.endsWith(':read'));
  return [...reads, Permission.DATA_SCOPE_ALL, ...SUPPORT_SENSITIVE_PERMISSIONS];
}

/** ¿Algún permiso pedido es de escritura sensible? Entonces la sesión necesita el consentimiento. */
export function needsSupportConsent(permissions: readonly string[]): boolean {
  return permissions.some((p) => SUPPORT_SENSITIVE_PERMISSIONS.includes(p));
}
