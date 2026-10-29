/**
 * Sustitución de variables `{{clave}}` en el cuerpo de una plantilla (p.ej. mensajes de WhatsApp).
 * Función pura, cero deps. La usan el móvil (al pintar la plantilla elegida) y, si algún día se
 * pre-renderiza en el server, la API.
 *
 * Una clave sin valor en `vars` se deja **literal** (`{{saldo}}` intacto), no se borra: es mejor que
 * el cobrador vea el hueco a que envíe un mensaje con un espacio donde iba el monto.
 */
export function renderTemplate(body: string, vars: Record<string, string | number | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/**
 * Las variables que `renderTemplate` sabe llenar hoy: **contrato con el móvil y la web**. Una plantilla puede
 * escribir cualquier `{{algo}}`, pero solo estas se reemplazan; el resto queda literal. Agregar una acá es
 * avisar que ambas plataformas deben alimentarla.
 */
export const TEMPLATE_VARIABLES = ['cliente', 'saldo', 'negocio', 'telefono_negocio'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Para qué situación de cobranza sirve una plantilla. Vive en `metadata.category` y es opcional. */
export const TEMPLATE_CATEGORIES = ['INITIAL', 'REMINDER', 'PROMISE', 'LAST_NOTICE', 'CONFIRMATION'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export function isTemplateCategory(v: unknown): v is TemplateCategory {
  return typeof v === 'string' && (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
}

/** Las claves distintas que usa el cuerpo, en orden de aparición. */
export function templateKeys(body: string): string[] {
  const keys = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) keys.add(m[1]!);
  return [...keys];
}

/** Las claves que el sistema no sabe llenar (un error de tipeo, p.ej. `{{clinte}}`): saldrían literales. */
export function unknownTemplateKeys(body: string): string[] {
  return templateKeys(body).filter((k) => !(TEMPLATE_VARIABLES as readonly string[]).includes(k));
}

/** Las variables conocidas que el cuerpo usa pero para las que `vars` no trae un valor (vacío cuenta como falta). */
export function missingTemplateKeys(body: string, vars: Record<string, string | number | undefined | null>): string[] {
  return templateKeys(body).filter(
    (k) => (TEMPLATE_VARIABLES as readonly string[]).includes(k) && (vars[k] === undefined || vars[k] === null || String(vars[k]).trim() === ''),
  );
}
