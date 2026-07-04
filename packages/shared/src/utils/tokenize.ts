/**
 * Tokenización de datos sensibles para mostrarlos parcialmente (privacy-first, §1.8
 * del doc de arquitectura). Puras y sin estado: las usa el serializer de respuestas de
 * la API (y opcionalmente web/mobile) para NUNCA exponer PII en claro por defecto.
 *
 *   maskDocument('12345678')      → '12345***'
 *   maskPhone('77712345')         → '777****'
 *   maskEmail('juan@banco.com')   → 'ju***@ba***.com'
 */

/** Muestra los primeros `visible` caracteres y enmascara el resto con `***`. */
function maskTail(value: string, visible: number): string {
  if (!value) return '';
  if (value.length <= visible) return '***';
  return `${value.slice(0, visible)}***`;
}

/** Documento (CI/NIT): primeros 5 visibles. `'12345678'` → `'12345***'`. */
export function maskDocument(value: string | null | undefined): string {
  if (!value) return '';
  return maskTail(value.trim(), 5);
}

/** Teléfono: primeros 3 visibles. `'77712345'` → `'777****'`. */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.trim();
  if (digits.length <= 3) return '***';
  return `${digits.slice(0, 3)}****`;
}

/** Email: 2 visibles del usuario y del dominio. `'juan@banco.com'` → `'ju***@ba***.com'`. */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return '';
  const parts = value.trim().split('@');
  const user = parts[0] ?? '';
  const domain = parts[1];
  if (!domain) return maskTail(value.trim(), 2);
  const tld = domain.includes('.') ? domain.slice(domain.lastIndexOf('.')) : '';
  const host = tld ? domain.slice(0, domain.lastIndexOf('.')) : domain;
  return `${maskTail(user, 2)}@${maskTail(host, 2)}${tld}`;
}
