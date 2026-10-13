/**
 * Cambiar a qué dirección del cliente va una parada (R3). `PATCH /routes/:id/stops/:sid { locationId }` es de **valor fijo**
 * (repetirlo es un no-op en el servidor), así que sin señal se guarda y sube sola.
 *
 * Solo quien armó la ruta puede (403 si no) y la parada debe estar pendiente (422 si ya se gestionó): son rechazos
 * definitivos que la hoja de pendientes muestra, no reintentos.
 */
import { updateStop } from './routes.service';
import { queueForLater } from './sync/sync.service';

export type ChangeLocationResult = { status: 'ok' } | { status: 'queued' } | { status: 'error'; message: string; code?: string };

export async function changeStopLocation(routeId: string, stopId: string, locationId: string): Promise<ChangeLocationResult> {
  const res = await updateStop(routeId, stopId, { locationId });
  if (res.status === 'ok') return { status: 'ok' };
  if (res.status === 'error') return { status: 'error', message: res.message, ...(res.code ? { code: res.code } : {}) };
  const saved = await queueForLater({ kind: 'route.stop.location', routeId, stopId, locationId });
  return saved ? { status: 'queued' } : { status: 'error', message: 'No se pudo guardar el cambio en el teléfono. Reintentá con señal.' };
}
