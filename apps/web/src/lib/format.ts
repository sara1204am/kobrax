/** Formateo para el panel (server-safe). */

export function money(amount: number | null | undefined, currency = 'BOB'): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('es-BO', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/*
 * ⚠️ El idioma se pasa, no se asume. Con `'es'` cableado, el panel en inglés mostraba «12 ago
 * 2026» — y en la agenda, esa fecha en español quedaba justo debajo de un encabezado que sí
 * estaba traducido: la misma pantalla decía la misma fecha en dos idiomas.
 *
 * El default sigue siendo `'es'` porque es el idioma por defecto del panel; quien tiene el locale
 * a mano (`useLocale()` en cliente, `getLocale()` en servidor) lo pasa.
 */
export function date(d?: string | null, locale = 'es'): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function dateTime(d?: string | null, locale = 'es'): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

export function fullName(c: { firstName?: string; lastName?: string; businessName?: string }): string {
  if (c.businessName) return c.businessName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
}
