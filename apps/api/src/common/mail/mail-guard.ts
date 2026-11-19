/**
 * Guardia de envío de correo: **jamás se manda un correo real** a una dirección de prueba ni desde un entorno de pruebas.
 *
 * Motivo (2026-11-19): el `.env` local tiene las credenciales SMTP reales y las pruebas de integración crean cuentas con
 * correos `@ejemplo.com`; cada alta mandaba un correo de verificación de verdad desde el Gmail del equipo, y los rebotes
 * llegaban a su bandeja. `ejemplo.com` no es un dominio reservado (RFC 2606): podía llegar a un tercero.
 *
 * Funciones puras, sin dependencias, para probarlas sin tocar nada.
 */

/** Dominios y sufijos que no deben recibir correo real (reservados por RFC 2606/6761 o usados por las pruebas). */
const BLOCKED_DOMAINS = ['ejemplo.com', 'example.com', 'example.org', 'example.net', 'kobrax.test'];
const BLOCKED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost', '.local'];

/** ¿La dirección es de prueba (nunca debe enviarse de verdad)? Cualquier cosa ilegible también se considera no enviable. */
export function isTestRecipient(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return true;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/>$/, '');
  if (!domain) return true;
  if (BLOCKED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return BLOCKED_SUFFIXES.some((s) => domain.endsWith(s)) || domain === 'localhost';
}

/** Por qué NO se debe enviar (texto para el log), o `null` si se puede enviar. */
export function mailBlockReason(to: string, env: { NODE_ENV?: string; MAIL_DISABLED?: string }): string | null {
  if (env.MAIL_DISABLED === '1' || env.MAIL_DISABLED === 'true') return 'MAIL_DISABLED activo';
  if (env.NODE_ENV === 'test') return 'NODE_ENV=test';
  // Cada destinatario de una lista separada por comas se revisa: basta uno de prueba para no enviar.
  if (to.split(',').some((addr) => isTestRecipient(addr.trim()))) return 'destinatario de prueba (dominio no enviable)';
  return null;
}
