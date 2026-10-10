/**
 * Notificaciones del cobrador (scope `own`: el server sólo devuelve las suyas).
 * Thin sobre `apiQuery`/`apiMutate`. El badge del Home usa `unreadCount`; la pantalla, el resto.
 */
import type { NotificationPayload } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import * as db from './db';
import { cachedList } from './sync/cached';
import { formatLongDate, toHHmm, toISO } from './agenda-form';

/** El buzón guardado (`?limit=50`): lo último que se vio con señal. */
const INBOX_SCOPE = toQuery({ limit: 50 });

/**
 * Nº de notificaciones no leídas (usa `meta.total`; pide 1 fila, solo importa el conteo). **Sin señal** cuenta las no leídas
 * del buzón guardado: antes decía 0 y la campanita parecía vacía justo cuando el cobrador no podía mirar.
 */
export async function unreadCount(): Promise<number> {
  const res: QueryResult<NotificationPayload[]> = await apiQuery('/notifications?unread=true&limit=1');
  if (res.status === 'ok') return res.total;
  if (res.status !== 'offline') return 0;
  try {
    const rows = await db.getMany<NotificationPayload>('notification', INBOX_SCOPE);
    return rows.filter((n) => !n.readAt).length;
  } catch {
    return 0;
  }
}

/** El buzón. `unread` filtra a las pendientes; sin él vienen todas, leídas incluidas. */
export function listNotifications(unread?: boolean): Promise<QueryResult<NotificationPayload[]>> {
  const query = toQuery({ unread, limit: 50 });
  return cachedList<NotificationPayload>('notification', query || 'todas', () =>
    apiQuery<NotificationPayload[]>(`/notifications${query}`),
  );
}

/** Ambas responden 204 (sin cuerpo) — `apiMutate` ya lo trata como éxito. */
export function markRead(id: string): Promise<MutateResult<null>> {
  return apiMutate<null>(`/notifications/${id}/read`, 'POST');
}

export function markAllRead(): Promise<MutateResult<null>> {
  return apiMutate<null>('/notifications/read-all', 'POST');
}

/**
 * Cuándo llegó, en el mínimo de texto que sirve: de hoy importa la hora, de otro día importa la
 * fecha. Sin "hace 5 minutos" — obliga a re-renderizar para no mentir, y acá no aporta nada.
 *
 * Las dos fechas se comparan con `toISO` (día LOCAL). Usar `todayISO()`, que es UTC, haría que
 * una notificación de anoche saliera con fecha en vez de hora según la hora del día.
 */
export function whenLabel(iso: string, today: string = toISO(new Date())): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return toISO(d) === today ? toHHmm(d) : formatLongDate(toISO(d));
}
