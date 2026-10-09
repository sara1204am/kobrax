import { NotificationType, type NotificationPayload } from '@kobrax/shared';

/**
 * A dónde lleva un aviso de la campanita. Un aviso que no lleva a ningún lado es solo un texto: este es el destino
 * de cada uno, del más específico al más general.
 *
 *  - habla de una gestión → esa gestión;
 *  - es el resumen de vencidas → la agenda;
 *  - habla de un crédito → su ficha de mora;
 *  - el resto (avisos del sistema) → ninguno: se marcan leídos y listo.
 */
export function notificationHref(n: Pick<NotificationPayload, 'type' | 'agendaItemId' | 'creditId'>): string | undefined {
  if (n.agendaItemId) return `/agenda/${n.agendaItemId}`;
  if (n.type === NotificationType.AGENDA_OVERDUE) return '/agenda';
  if (n.creditId) return `/mora/${n.creditId}`;
  return undefined;
}
