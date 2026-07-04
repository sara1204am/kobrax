/** Marcador con el que se reemplaza cualquier valor sensible en los snapshots de auditoría. */
export const REDACTED = '[REDACTED]';

/**
 * Claves consideradas PII/secretas (case-insensitive, sin `_`). El audit trail NUNCA
 * debe persistir estos valores en claro en `before/after`.
 */
const DEFAULT_SENSITIVE = new Set([
  'password',
  'passwordhash',
  'salt',
  'mfasecret',
  'token',
  'tokenhash',
  'refreshtoken',
  'accesstoken',
  'nationalid',
  'taxid',
  'documentnumber',
  'phone',
  'value', // contact.value
  'address',
  'codehash',
]);

function isSensitive(key: string, extra: Set<string>): boolean {
  const k = key.toLowerCase().replace(/_/g, '');
  return DEFAULT_SENSITIVE.has(k) || extra.has(k);
}

/**
 * Devuelve una copia con los valores de claves sensibles reemplazados por `[REDACTED]`.
 * Recorre objetos/arrays (profundidad acotada para evitar ciclos). No muta la entrada.
 */
export function redactPII(input: unknown, extra: string[] = [], depth = 0): unknown {
  if (depth > 6 || input === null || typeof input !== 'object') return input;
  const extraSet = new Set(extra.map((e) => e.toLowerCase().replace(/_/g, '')));

  if (Array.isArray(input)) return input.map((v) => redactPII(v, extra, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    out[key] = isSensitive(key, extraSet) ? REDACTED : redactPII(val, extra, depth + 1);
  }
  return out;
}
