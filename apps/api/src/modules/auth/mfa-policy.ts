/**
 * Política de MFA para roles críticos (D2). Una sola fuente: la usan el login, el enrolamiento, el desactivado y `/auth/me`.
 *
 * - **Roles críticos**: `SUPER_ADMIN` y `ACCOUNT_ADMIN` (los de `CRITICAL_ROLES`, ya existentes). Una persona es crítica si
 *   tiene **alguna** membresía activa con uno de esos roles: el segundo factor es de la persona, no de la empresa.
 * - **Obligatorio**: no se puede desactivar ni postergar el enrolamiento. La regla vive en el servidor; ocultar botones es solo UX.
 * - **Transición explícita**: `MFA_CRITICAL_GRACE_UNTIL` (fecha ISO). Hasta esa fecha un crítico todavía puede postergar el
 *   enrolamiento (`setup/skip`) y el login lo avisa; pasada la fecha, o **sin variable** (enforcement inmediato), no. Desactivar
 *   un MFA ya activo está prohibido siempre: la gracia es solo para quien aún no lo tiene.
 */

/** Roles que exigen MFA obligatorio (F2b enforcement). */
export const CRITICAL_ROLES: readonly string[] = ['SUPER_ADMIN', 'ACCOUNT_ADMIN'];

export const isCriticalRole = (roleName: string | null | undefined): boolean => !!roleName && CRITICAL_ROLES.includes(roleName);

/** Hasta cuándo un crítico sin MFA puede postergar el enrolamiento. `null` = sin gracia (enforcement inmediato). */
export function graceUntil(env: string | undefined = process.env.MFA_CRITICAL_GRACE_UNTIL): Date | null {
  if (!env) return null;
  const t = Date.parse(env);
  return Number.isNaN(t) ? null : new Date(t);
}

/** ¿Todavía se puede postergar el enrolamiento? Solo dentro de la gracia explícita. */
export function canPostponeEnrollment(now: Date = new Date(), grace: Date | null = graceUntil()): boolean {
  return grace !== null && now.getTime() < grace.getTime();
}
