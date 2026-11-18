import { NotificationType, type NotificationPayload, type ResolvedWorkspace } from '@kobrax/shared';

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
export function notificationHref(
  n: Pick<NotificationPayload, 'type' | 'agendaItemId' | 'creditId'> & { routeId?: string | null },
  workspace?: Pick<ResolvedWorkspace, 'showsModule'>,
): string | undefined {
  // Una ruta (F4/12: te la asignaron, la cancelaron, piden o resolvieron un cambio): su detalle. F15 · A-5: si la organización
  // ocultó Rutas el aviso NO apunta ahí; cae a lo siguiente que diga el aviso (o a ninguno: se marca leído y listo).
  if (n.routeId && (workspace?.showsModule('routes') ?? true)) return `/rutas/${n.routeId}`;
  if (n.agendaItemId) return `/agenda/${n.agendaItemId}`;
  if (n.type === NotificationType.AGENDA_OVERDUE) return '/agenda';
  if (n.creditId) return `/mora/${n.creditId}`;
  return undefined;
}
