import type { Notification } from '@prisma/client';
import type { NotificationPayload } from '@kobrax/shared';

/** Convierte una fila `notifications` al payload público (fechas ISO). */
export function serializeNotification(n: Notification): NotificationPayload {
  return {
    id: n.id,
    type: n.type as NotificationPayload['type'],
    title: n.title,
    body: n.body,
    clientId: n.clientId,
    creditId: n.creditId,
    caseId: n.caseId,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}
