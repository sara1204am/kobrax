/**
 * Catálogo canónico de campos del import (FIELD-RULES §2) + normalización.
 *
 * Es la ÚNICA lista de campos que el import puede escribir. Un dato del archivo que no se
 * empareja con uno de estos se descarta; no hay JSON basurero.
 *
 * No contiene NINGUNA tabla por banco (C12): qué campos hay disponibles para emparejar lo dice
 * el archivo del cliente, no nosotros. Acá sólo vive qué campos existen y de qué tipo son.
 */

export type FieldType = 'text' | 'number' | 'int' | 'date';

export interface FieldDef {
  /** Etiqueta en español para la UI de emparejado. */
  label: string;
  type: FieldType;
  /** Se ofrece encendido por defecto al configurar por primera vez (los ⭐ de §2). */
  starred?: boolean;
  /** No se puede apagar ni desmapear. */
  locked?: boolean;
}

export const FIELD_CATALOG: Record<string, FieldDef> = {
  code: { label: 'N° de crédito', type: 'text', starred: true, locked: true },
  clientName: { label: 'Cliente (nombre completo)', type: 'text', starred: true, locked: true },
  clientLastName: { label: 'Apellidos', type: 'text' },
  clientFirstName: { label: 'Nombres', type: 'text' },
  installmentAmount: { label: 'Cuota', type: 'number', starred: true },
  daysPastDue: { label: 'Días de retraso', type: 'int', starred: true },
  outstandingBalance: { label: 'Saldo', type: 'number', starred: true },
  coHolder: { label: 'Co-titular', type: 'text' },
  status: { label: 'Estado', type: 'text' },
  principalAmount: { label: 'Capital', type: 'number' },
  interestRate: { label: 'Tasa de interés', type: 'number' },
  currency: { label: 'Moneda', type: 'text' },
  disbursedAt: { label: 'Fecha de desembolso', type: 'date' },
  pastDueAmount: { label: 'Monto en mora', type: 'number' },
  nextDueDate: { label: 'Próximo vencimiento', type: 'date' },
  branchLabel: { label: 'Agencia', type: 'text' },
};

export type CanonicalField = keyof typeof FIELD_CATALOG;

/** Cómo separar un nombre completo cuando la DB tiene apellido y nombre por separado (§2.3). */
export type NameOrder = 'full' | 'surnames-first' | 'split-columns';

/** Valores ya tipados, listos para la DB. */
export interface NormalizedRecord {
  code: string | null;
  clientLastName: string | null;
  clientFirstName: string | null;
  coHolder: string | null;
  status: string | null;
  currency: string | null;
  branchLabel: string | null;
  principalAmount: number | null;
  outstandingBalance: number | null;
  interestRate: number | null;
  installmentAmount: number | null;
  pastDueAmount: number | null;
  daysPastDue: number | null;
  disbursedAt: string | null;
  nextDueDate: string | null;
}

/**
 * Crudo → tipado. Las reglas son las mismas para toda forma de archivo (§4.4).
 *
 * Regla dura: **ausente (`null`) ≠ cero**. Un valor que no se pudo leer vuelve `null` y el
 * service NO escribe esa columna; si escribiera 0, un archivo con otro layout pondría toda la
 * cartera en cero. La excepción deliberada es una columna que EXISTE y está en blanco (`''`):
 * eso sí es un cero leído, porque el formato no imprime nada cuando el valor es cero.
 */
export function normalizeRecord(raw: Record<string, string | null>, nameOrder: NameOrder = 'full'): NormalizedRecord {
  const text = (k: string): string | null => {
    const v = raw[k];
    return v == null || v.trim() === '' ? null : v.trim();
  };
  const number = (k: string): number | null => {
    const v = raw[k];
    if (v == null) return null;
    if (v.trim() === '') return 0; // columna presente y en blanco = cero leído
    return num(v);
  };

  const { lastName, firstName } = splitName(text('clientName'), nameOrder, {
    lastName: text('clientLastName'),
    firstName: text('clientFirstName'),
  });

  return {
    code: text('code'),
    clientLastName: lastName,
    clientFirstName: firstName,
    coHolder: text('coHolder'),
    status: text('status'),
    currency: text('currency'),
    branchLabel: text('branchLabel'),
    principalAmount: number('principalAmount'),
    outstandingBalance: number('outstandingBalance'),
    interestRate: number('interestRate'),
    installmentAmount: number('installmentAmount'),
    pastDueAmount: number('pastDueAmount'),
    daysPastDue: intOrNull(number('daysPastDue')),
    disbursedAt: toIso(text('disbursedAt')),
    nextDueDate: toIso(text('nextDueDate')),
  };
}

/** Partículas que se pegan a la palabra siguiente y no cuentan como apellido propio. */
const PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y']);

/**
 * Separa un nombre completo. El archivo no dice dónde termina el apellido, así que la regla
 * la elige el usuario una vez (§2.3). `full` manda todo a APELLIDO —no a nombre— porque los
 * listados de cartera vienen `APELLIDO APELLIDO NOMBRE`: la cadena empieza por el apellido.
 */
export function splitName(
  full: string | null,
  order: NameOrder,
  columns: { lastName: string | null; firstName: string | null } = { lastName: null, firstName: null },
): { lastName: string | null; firstName: string | null } {
  if (order === 'split-columns') return columns;
  if (!full) return { lastName: null, firstName: null };
  if (order !== 'surnames-first') return { lastName: full, firstName: null };

  const words = full.split(/\s+/).filter(Boolean);
  const surnames: string[] = [];
  let i = 0;
  while (i < words.length && surnames.filter((w) => !PARTICLES.has(w)).length < 2) {
    surnames.push(words[i]!);
    i++;
  }
  // Menos de 3 palabras: no alcanza para separar sin adivinar → se deja entero.
  if (words.length < 3 || i >= words.length) return { lastName: full, firstName: null };
  return { lastName: surnames.join(' '), firstName: words.slice(i).join(' ') };
}

function intOrNull(n: number | null): number | null {
  return n === null || !Number.isFinite(n) ? null : Math.trunc(n);
}

/**
 * "859,743.98" → 859743.98 · "1.996.85" → 1996.85 · "1.682,11" → 1682.11 · "( 4,767.67)" →
 * -4767.67 · "7.00 %" → 7.
 *
 * No se puede fijar una convención de separadores: los reportes de un mismo país mezclan las
 * tres, y un saldo mal leído es peor que uno que falta —se importa sin que nadie lo note—. La
 * regla que las cubre a todas: **el último separador es el decimal si lo siguen una o dos
 * cifras**; cualquier otro agrupa miles. Por eso "1.234" es mil doscientos treinta y cuatro y no
 * uno con doscientos treinta y cuatro: tres cifras detrás son un grupo de miles, no decimales.
 */
export function num(s: string | null): number | null {
  if (!s) return null;
  let t = s.replace(/%/g, '').trim();
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/\s/g, '');
  const lastSep = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  const decimals = t.length - lastSep - 1;
  t =
    lastSep !== -1 && decimals >= 1 && decimals <= 2
      ? `${t.slice(0, lastSep).replace(/[.,]/g, '')}.${t.slice(lastSep + 1)}`
      : t.replace(/[.,]/g, '');
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

/** "27/06/2024" (dd/mm/yyyy) → "2024-06-27". Sin `Date` (evita corrimientos de TZ). */
export function toIso(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
