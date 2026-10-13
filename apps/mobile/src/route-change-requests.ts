/**
 * Pedidos de cambio sobre una ruta que armó otra persona (R4). Quien no es dueño de la ruta no la modifica: pide el cambio,
 * con motivo, y quien la armó lo aprueba o lo rechaza. Es el mismo flujo que la web.
 *
 * 🔴 Esto solo decide qué se **ofrece**; el servidor decide quién puede (capabilities, 403, 422). Las `capabilities` cacheadas
 * pueden estar viejas: nunca se asume un permiso, solo se muestra el botón.
 *
 * Offline:
 *  - **Pedir**: el teléfono pone el `id` del pedido (`nuevoId()`); viaja igual en el intento y en la cola, y el servidor
 *    devuelve el ya creado si el intento anterior llegó. Sin señal se guarda y sube solo.
 *  - **Decidir**: valor fijo (APPROVE/REJECT/WITHDRAW). Si otra persona ya lo resolvió (409) es un rechazo definitivo que se
 *    explica en «Sin subir».
 */
import { isValidReason, type RouteChangeKind, type RouteChangeRequestItem } from '@kobrax/shared';
import { createChangeRequest, decideChangeRequest, listChangeRequests, type ChangeDecision, type NewChangeRequest } from './routes.service';
import { nuevoId } from './ids';
import { queueForLater } from './sync/sync.service';

export type { RouteChangeKind, RouteChangeRequestItem, ChangeDecision, NewChangeRequest };
export { listChangeRequests };
export const CHANGE_KIND_LABEL: Record<RouteChangeKind, string> = {
  ADD_STOP: 'Agregar una parada',
  REMOVE_STOP: 'Quitar una parada',
  REORDER: 'Cambiar el orden',
  CANCEL: 'Cancelar la ruta',
};

export const CHANGE_STATUS_LABEL: Record<RouteChangeRequestItem['status'], string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  WITHDRAWN: 'Retirado',
};

export type SubmitResult = { status: 'ok' } | { status: 'queued' } | { status: 'invalid'; message: string } | { status: 'error'; message: string };

/** Pide un cambio. `id` fijo por intento de la pantalla: reintentar no duplica. */
export async function submitChangeRequest(
  routeId: string,
  kind: RouteChangeKind,
  reason: string,
  payload?: Record<string, unknown>,
  id: string = nuevoId(),
): Promise<SubmitResult> {
  const why = reason.trim();
  if (!isValidReason(why)) return { status: 'invalid', message: 'Contá el motivo (al menos 5 caracteres).' };
  const input: NewChangeRequest = { id, kind, reason: why, ...(payload ? { payload } : {}) };
  const res = await createChangeRequest(routeId, input);
  if (res.status === 'ok') return { status: 'ok' };
  if (res.status === 'error') return { status: 'error', message: res.message };
  const saved = await queueForLater({ kind: 'route.change.create', routeId, input });
  return saved ? { status: 'queued' } : { status: 'error', message: 'No se pudo guardar el pedido en el teléfono. Reintentá con señal.' };
}

export async function submitDecision(routeId: string, requestId: string, decision: ChangeDecision, note?: string): Promise<SubmitResult> {
  const res = await decideChangeRequest(routeId, requestId, decision, note);
  if (res.status === 'ok') return { status: 'ok' };
  if (res.status === 'error') return { status: 'error', message: res.message };
  const saved = await queueForLater({ kind: 'route.change.decide', routeId, requestId, decision, ...(note ? { note } : {}) });
  return saved ? { status: 'queued' } : { status: 'error', message: 'No se pudo guardar la decisión en el teléfono. Reintentá con señal.' };
}
