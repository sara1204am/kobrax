/**
 * Cómo se lee un registro de auditoría en la pestaña «Actividad» de la cuenta: qué campos cambiaron, sin ruido y sin
 * secretos. Funciones puras: son la parte que puede filtrar de más, y así se prueban sin base.
 */

/** Las entidades que son «de la cuenta»: su configuración, su equipo, sus listas y sus pedidos a Kobrax. */
export const ACCOUNT_ACTIVITY_ENTITIES = [
  'account',
  'branch',
  'catalog_item',
  'arrear_category',
  'user_account',
  'account_request',
] as const;

/** Columnas que cambian solas o no dicen nada al leerlas. */
const NOISE = new Set(['id', 'accountId', 'createdAt', 'updatedAt', 'deletedAt', 'via']);

/** Nunca se muestra el valor: sólo que cambió. */
const SECRET = /password|secret|token|hash|key|pin/i;

const MAX_CHANGES = 12;
const MAX_VALUE = 120;

type Json = Record<string, unknown>;

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

const isPlainObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Aplana objetos anidados a `a.b.c` para comparar hoja por hoja; los arreglos y fechas quedan enteros. */
function flatten(value: Json, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(v) && Object.keys(v).length > 0) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

function show(field: string, v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (SECRET.test(field)) return '••••';
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

/**
 * Qué campos cambiaron entre `before` y `after`. Sólo para ediciones: una alta o una baja no tienen «de → a» que valga la
 * pena leer línea por línea.
 */
export function describeChanges(before: unknown, after: unknown): FieldChange[] {
  if (!isPlainObject(before) || !isPlainObject(after)) return [];
  const a = flatten(before);
  const b = flatten(after);
  const out: FieldChange[] = [];
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const leaf = field.split('.').pop() ?? field;
    if (NOISE.has(leaf)) continue;
    if (JSON.stringify(a[field] ?? null) === JSON.stringify(b[field] ?? null)) continue;
    out.push({ field, from: show(field, a[field]), to: show(field, b[field]) });
    if (out.length >= MAX_CHANGES) break;
  }
  return out;
}

/** Si el cambio lo hizo Kobrax por consola (`plan:set`, `account:suspend`, `plan:lifecycle`), cuál fue. */
export function viaOf(after: unknown): string | null {
  const via = isPlainObject(after) ? after.via : undefined;
  return typeof via === 'string' ? via : null;
}
