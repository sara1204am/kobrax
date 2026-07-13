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
