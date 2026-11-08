/**
 * Por qué el servidor RECHAZÓ algo que el cobrador hizo sin señal, dicho para el cobrador (F14 · F8, N-06).
 *
 * Con el modelo de permisos de F14 hay tres razones nuevas por las que una acción encolada puede no aplicarse al subir:
 *  · **404** — ya no ve a ese cliente o crédito (lo lleva ahora otra persona, cambió de oficina o se eliminó);
 *  · **403** — su rol o su oficina ya no permiten esa acción (le cambiaron el rol mientras estaba sin señal);
 *  · **422 de oficina** — el alta no dice en qué oficina se registra.
 *
 * Sin esto la hoja de pendientes mostraba el texto técnico del servidor. La agenda tiene sus propias explicaciones (`agenda-conflicts.ts`) y no pasa por acá.
 * El resto de los errores conserva el mensaje del servidor: ya es específico y está en español.
 */

/** El alta no dice en qué oficina se registra (o dice una que no sirve): hay que elegir. */
const OFFICE_MISSING = new Set(['CLIENT_BRANCH_UNRESOLVED', 'CLIENT_CREATE_AT_ROOT', 'CLIENT_BRANCH_INVALID']);

export function explainRejection(opts: { httpStatus?: number; code?: string; message: string }): string {
  const { httpStatus, code, message } = opts;
  if (code && OFFICE_MISSING.has(code)) {
    return 'Falta elegir en qué oficina se registra el cliente. Lo que hiciste acá no se aplicó: descártalo y vuelve a crear el cliente eligiendo la oficina.';
  }
  // Eligió una oficina, pero no puede registrar clientes en ella: se explica distinto (y el servidor ya dice cuál).
  if (code === 'CLIENT_BRANCH_OUT_OF_SCOPE') {
    return 'No puedes registrar clientes en esa oficina. Lo que hiciste acá no se aplicó: descártalo y créalo de nuevo eligiendo otra oficina.';
  }
  if (code === 'CLIENT_DUP') {
    return 'Ya existe un cliente con ese documento. Lo que hiciste acá no se aplicó: búscalo, o si lo llevan otras personas usa «Crear mi préstamo» sobre ese cliente.';
  }
  if (httpStatus === 404) {
    return 'Ya no tienes acceso a este cliente o crédito: lo lleva ahora otra persona, cambió de oficina o se eliminó. Lo que hiciste acá no se aplicó.';
  }
  if (httpStatus === 403) {
    return 'Tu rol o tu oficina ya no permiten esta acción. Lo que hiciste acá no se aplicó. Si crees que es un error, habla con tu supervisor.';
  }
  return message;
}
