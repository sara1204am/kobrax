/** Tipo de notificación operativa. */
export enum NotificationType {
  PAYMENT_REGISTERED = 'PAYMENT_REGISTERED',
  ROUTE_ASSIGNED = 'ROUTE_ASSIGNED',
  PROMISE_DUE = 'PROMISE_DUE',
  SYSTEM = 'SYSTEM',
  /** Alguien te asignó una gestión de agenda. */
  AGENDA_ASSIGNED = 'AGENDA_ASSIGNED',
  /** Alguien cambió una gestión tuya (reagendó, canceló, eliminó o editó). */
  AGENDA_CHANGED = 'AGENDA_CHANGED',
  /** Resumen diario de gestiones vencidas. */
  AGENDA_OVERDUE = 'AGENDA_OVERDUE',
}
