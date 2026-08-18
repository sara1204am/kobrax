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

/**
 * Un **día civil**: el de una ruta, el de un agendado. Sin hora, porque en la base tampoco la tiene
 * (`@db.Date`).
 *
 * 🔴 **Va en UTC a propósito, y no es lo mismo que `date()`.** Un `@db.Date` llega como
 * `2026-08-20T00:00:00.000Z`, así que formatearlo en la zona local resta cuatro horas en Bolivia y
 * lo pinta como **19 de agosto**: la ruta del jueves aparece como la del miércoles. Es el mismo
 * supuesto que ya había mordido a la agenda del lado del servidor, ahora del lado de quien mira.
 * `date()` sigue siendo el correcto para lo que sí tiene hora — un pago, una gestión.
 */
export function dayDate(d?: string | null, locale = 'es'): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * La hora sola: «09:05». Para cuando la fecha ya la dice la pantalla y repetirla es ruido —el
 * recorrido de una jornada, donde todas las paradas son del mismo día.
 *
 * A diferencia de `dayDate`, esto **sí va en hora local**: es un instante, no un día civil. Un
 * timestamp de visita marca el momento en que alguien tocó un timbre.
 */
export function time(d?: string | null, locale = 'es'): string {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(d?: string | null, locale = 'es'): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Un porcentaje que ya viene en 0-100.
 *
 * Con `${v}%` a secas salía «99.9%» —punto decimal inglés— al lado de «Bs 17.892.273,30», que sí
 * está localizado. La misma tarjeta mostraba dos convenciones de número.
 */
export function percent(value: number, digits = 1): string {
  return `${new Intl.NumberFormat('es-BO', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} %`;
}

/**
 * «hoy, 10:45» · «ayer, 16:20» · «hace 5 días, 09:30».
 *
 * 🔴 **Sin una sola palabra escrita acá.** `Intl.RelativeTimeFormat` con `numeric: 'auto'` dice
 * «ayer» en español y «yesterday» en inglés solo: escribir esas palabras en un util sería meter
 * texto de un idioma en la capa que menos debe tenerlo, y habría que traducirlo dos veces.
 *
 * La hora va junto a la fecha porque en una bitácora de cobranza importa: «visita, ayer 8:00» y
 * «visita, ayer 20:00» son dos historias distintas.
 */
export function relativeDate(d?: string | null, locale = 'es'): string {
  if (!d) return '—';
  const when = new Date(d);
  if (Number.isNaN(when.getTime())) return '—';

  // Diferencia en días de CALENDARIO, no en horas: a las 23:00, algo de las 01:00 del mismo día es
  // «hoy», y con horas daría «hace 22 horas», que obliga a hacer la cuenta mentalmente.
  const dia = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const dias = Math.round((dia(when) - dia(new Date())) / 86_400_000);
  const hora = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  // Más de un mes atrás, la fecha exacta dice más que «hace 6 semanas».
  if (Math.abs(dias) > 30) return `${date(d, locale)}, ${hora}`;
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(dias, 'day');
  return `${rel}, ${hora}`;
}

export function fullName(c: { firstName?: string; lastName?: string; businessName?: string }): string {
  if (c.businessName) return c.businessName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
}
