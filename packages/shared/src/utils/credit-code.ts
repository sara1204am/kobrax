/**
 * El Nº de crédito automático: una **máscara** que fija la cuenta (Cuenta › Cobranza).
 *
 * `CR-######` → texto fijo `CR-` y una parte numérica de 6 dígitos con ceros a la izquierda (`CR-000001`). Los `#` son la
 * parte numérica (un solo tramo, de 1 a 9); lo demás, antes o después, es texto fijo. Sin configurar vale `CR-######`.
 *
 * Sólo aplica a los créditos que se cargan a mano: lo que viene de una importación trae su propio código y no se toca.
 * El siguiente número es el mayor ya usado con ESTA máscara + 1: al cambiar el texto fijo la numeración empieza de cero,
 * y al cambiar sólo el ancho sigue donde iba.
 */
export const DEFAULT_CREDIT_CODE_MASK = 'CR-######';
export const CREDIT_CODE_MASK_MAX = 30;

export interface CreditCodeMask {
  prefix: string;
  digits: number;
  suffix: string;
}

/** `null` si la máscara no es válida (sin `#`, con dos tramos, demasiado larga o con más de 9 dígitos). */
export function parseCreditCodeMask(mask: unknown): CreditCodeMask | null {
  if (typeof mask !== 'string' || mask.length === 0 || mask.length > CREDIT_CODE_MASK_MAX) return null;
  const m = /^([^#]*)(#{1,9})([^#]*)$/.exec(mask);
  if (!m) return null;
  const [, prefix, hashes, suffix] = m;
  // Nada de espacios sueltos ni saltos: el código viaja en listados y archivos.
  if (/[\s]/.test(`${prefix}${suffix}`) || `${prefix}${suffix}`.length > 20) return null;
  return { prefix: prefix!, digits: hashes!.length, suffix: suffix! };
}

/** La máscara de la cuenta (`settings.creditCodeMask`); si falta o no vale, la de siempre. */
export function creditCodeMaskOf(settings: unknown): string {
  const raw = (settings as { creditCodeMask?: unknown } | null | undefined)?.creditCodeMask;
  return parseCreditCodeMask(raw) ? (raw as string) : DEFAULT_CREDIT_CODE_MASK;
}

/** El código del número `n` con esa máscara. Si `n` no cabe en los dígitos, crece (no se corta). */
export function formatCreditCode(mask: string, n: number): string {
  const p = parseCreditCodeMask(mask) ?? parseCreditCodeMask(DEFAULT_CREDIT_CODE_MASK)!;
  return `${p.prefix}${String(n).padStart(p.digits, '0')}${p.suffix}`;
}

/** Expresión regular (POSIX, para Postgres) con un grupo: la parte numérica de los códigos de esta máscara. */
export function creditCodePattern(mask: string): string {
  const p = parseCreditCodeMask(mask) ?? parseCreditCodeMask(DEFAULT_CREDIT_CODE_MASK)!;
  const esc = (s: string) => s.replace(/[^A-Za-z0-9]/g, (c) => '\\' + c);
  return `^${esc(p.prefix)}([0-9]{${p.digits},9})${esc(p.suffix)}$`;
}
