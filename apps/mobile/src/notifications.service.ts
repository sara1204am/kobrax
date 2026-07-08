/**
 * Notificaciones. En P1 solo el CONTADOR de no-leídas (badge del Home); la pantalla y el
 * marcar-leído son P2 (`POST /notifications/:id/read`). Thin sobre `apiQuery`.
 */
import type { NotificationPayload } from '@kobrax/shared';
import { apiQuery, type QueryResult } from './api-client';

/** Nº de notificaciones no leídas (usa `meta.total`; pide 1 fila, solo importa el conteo). */
export async function unreadCount(): Promise<number> {
  const res: QueryResult<NotificationPayload[]> = await apiQuery('/notifications?unread=true&limit=1');
  return res.status === 'ok' ? res.total : 0;
}
