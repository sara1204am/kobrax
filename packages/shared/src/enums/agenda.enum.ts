/** Tipo de gestión agendada (define los campos específicos en `details`). */
export enum AgendaItemType {
  CALL = 'CALL',
  VISIT = 'VISIT',
  WHATSAPP = 'WHATSAPP',
  REMINDER = 'REMINDER',
  PROMISE_TO_PAY = 'PROMISE_TO_PAY',
}

/** Estado de una gestión agendada. `EXPIRED` es derivado (SCHEDULED && fecha < hoy), no se persiste. */
export enum AgendaItemStatus {
  SCHEDULED = 'SCHEDULED',
  EXECUTED = 'EXECUTED',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
}

/** Modo de la hora en la programación. */
export enum ScheduleTimeMode {
  FIXED = 'FIXED', // hora exacta (08:30)
  LAPSE = 'LAPSE', // franja (MORNING/AFTERNOON/NIGHT)
  RANGE = 'RANGE', // rango ("08:00-10:00")
}

/** Franjas del modo `LAPSE`. Se persisten como texto en `agenda_items.time_slot`. */
export enum AgendaTimeSlot {
  MORNING = 'MORNING',
  AFTERNOON = 'AFTERNOON',
  NIGHT = 'NIGHT',
}

/** Tipos de catálogo configurable por tenant (una sola tabla `catalog_items` los cubre). */
export enum CatalogType {
  PAYMENT_METHOD = 'PAYMENT_METHOD',
  BANK = 'BANK',
  EXPECTED_RESULT = 'EXPECTED_RESULT',
  PRIORITY = 'PRIORITY',
  ADDRESS_TYPE = 'ADDRESS_TYPE',
  PHONE_TYPE = 'PHONE_TYPE',
  CANCEL_REASON = 'CANCEL_REASON',
  RESCHEDULE_REASON = 'RESCHEDULE_REASON',
  REMINDER_CATEGORY = 'REMINDER_CATEGORY',
  CAMPAIGN = 'CAMPAIGN',
  CURRENCY = 'CURRENCY',
}
