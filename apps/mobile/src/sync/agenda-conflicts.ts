/**
 * Por qué una acción de agenda que el cobrador hizo sin señal NO pudo subir, dicho para el cobrador (F4/11 · E6).
 *
 * Antes la hoja de pendientes mostraba el mensaje crudo del servidor («La gestión ya no está pendiente»), que no explica
 * qué pasó ni qué hacer. Tres casos reales:
 *
 *  · 409 — la gestión ya no estaba pendiente cuando subió: otra persona la ejecutó, la canceló o la reagendó mientras el
 *    cobrador estaba sin señal. Lo hecho en el teléfono no se aplicó, y no hay nada que reintentar.
 *  · 404 — la gestión ya no es suya o ya no existe: se la reasignaron a otra persona o la eliminaron.
 *  · 403 — no le corresponde (por ejemplo, intentó editar o eliminar algo que creó otra persona).
 *
 * El resto de los errores conserva el mensaje del servidor: ya es específico y está en español.
 */

/** Lo que dice la hoja de pendientes. */
export function explainAgendaRejection(httpStatus: number | undefined, serverMessage: string): string {
  switch (httpStatus) {
    case 409:
      return 'Esta gestión cambió mientras no tenías señal: otra persona la registró, la canceló o la reagendó. Lo que hiciste acá no se aplicó. Revisa cómo quedó en la Agenda.';
    case 404:
      return 'Esta gestión ya no está disponible para ti: la eliminaron o se la pasaron a otra persona. Lo que hiciste acá no se aplicó.';
    case 403:
      return 'No tienes permiso para este cambio sobre esa gestión. Si la creó otra persona, solo ella puede editarla o eliminarla.';
    default:
      return serverMessage;
  }
}

/** Aplica la explicación a un resultado de la cola: solo toca los rechazos definitivos de la agenda. */
export function withAgendaExplanation<R extends { status: string; message?: string; permanent?: boolean }>(
  result: R,
  httpStatus: number | undefined,
): R {
  if (result.status !== 'error' || !result.permanent) return result;
  return { ...result, message: explainAgendaRejection(httpStatus, result.message ?? 'No se pudo subir') };
}
