/** Formateo para el panel (server-safe). */

export function money(amount: number | null | undefined, currency = 'BOB'): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('es-BO', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function date(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function dateTime(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}

export function fullName(c: { firstName?: string; lastName?: string; businessName?: string }): string {
  if (c.businessName) return c.businessName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
}
