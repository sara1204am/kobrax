/**
 * Cancelar una ruta con motivo (R5). Es la contraparte de «Cerrar jornada»: misma ruta, mismo `PATCH /routes/:id`, misma cola.
 *
 * - **Con señal** va directo y el servidor decide (sin visitas, motivo válido, ruta propia o con permiso).
 * - **Sin señal o con la sesión vencida** queda encolada con su motivo (`route.status` es de valor fijo: reintentar es seguro) y
 *   la pantalla lo dice. Nunca se bloquea.
 * - Un rechazo definitivo del servidor se devuelve con su código para que la pantalla explique (p. ej. `ROUTE_HAS_VISITS`).
 */
import { RouteStatus, isValidReason } from '@kobrax/shared';
import { updateRouteStatus } from './routes.service';
import { queueForLater } from './sync/sync.service';

export type CancelRouteResult =
  | { status: 'cancelled' }
  | { status: 'queued' }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string; code?: string };

export async function cancelRouteWithReason(routeId: string, rawReason: string): Promise<CancelRouteResult> {
  const reason = rawReason.trim();
  if (!isValidReason(reason)) return { status: 'invalid', message: 'Contá el motivo (al menos 5 caracteres).' };

  const res = await updateRouteStatus(routeId, RouteStatus.CANCELLED, reason);
  if (res.status === 'ok') return { status: 'cancelled' };
  if (res.status === 'error') return { status: 'error', message: res.message, ...(res.code ? { code: res.code } : {}) };

  // offline o sesión vencida: se guarda en el teléfono y sube sola.
  const saved = await queueForLater({ kind: 'route.status', routeId, status: RouteStatus.CANCELLED, reason });
  return saved
    ? { status: 'queued' }
    : { status: 'error', message: 'No se pudo guardar la cancelación en el teléfono. Reintentá con señal.' };
}
