import { NotificationType, type NotificationPayload } from '@kobrax/shared';

/**
 * A dónde lleva un aviso de la campanita. Un aviso que no lleva a ningún lado es solo un texto: este es el destino
 * de cada uno, del más específico al más general.
 *
 *  - habla de una ruta → esa ruta;
 *  - habla de una gestión → esa gestión;
 *  - es el resumen de vencidas → la agenda;
 *  - habla de un crédito → su ficha de mora;
 *  - el resto (avisos del sistema) → ninguno: se marcan leídos y listo.
 */
export function notificationHref(n: Pick<NotificationPayload, 'type' | 'agendaItemId' | 'creditId'> & { routeId?: string | null }): string | undefined {
  // Una ruta (F4/12: te la asignaron, la cancelaron, piden o resolvieron un cambio): su detalle.
  if (n.routeId) return `/rutas/${n.routeId}`;
  if (n.agendaItemId) return `/agenda/${n.agendaItemId}`;
  if (n.type === NotificationType.AGENDA_OVERDUE) return '/agenda';
  if (n.creditId) return `/mora/${n.creditId}`;
  return undefined;
}
