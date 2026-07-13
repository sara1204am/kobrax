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

/**
 * Desenlace al ejecutar una gestión (S4). Estructural: el código ramifica el `CaseActivityType` y
 * el efecto sobre el caso según el outcome, por eso es enum en shared y no un catálogo por tenant.
 */
export enum AgendaOutcome {
  CONTACTED = 'CONTACTED', // habló con el deudor (llamada/whatsapp/visita)
  NO_ANSWER = 'NO_ANSWER', // llamó/escribió, no respondió
  WRONG_NUMBER = 'WRONG_NUMBER', // el número no es del deudor
  NOT_FOUND = 'NOT_FOUND', // fue al domicilio, no lo encontró
  WRONG_ADDRESS = 'WRONG_ADDRESS', // la dirección no corresponde
  PROMISE_KEPT = 'PROMISE_KEPT', // confirmó el pago de la promesa
  PROMISE_BROKEN = 'PROMISE_BROKEN', // no pagó
  DONE = 'DONE', // recordatorio realizado
}

/** Desenlaces válidos por tipo de gestión. La API rechaza un outcome fuera de esta lista (AGENDA_007). */
export const AGENDA_OUTCOMES_BY_TYPE: Record<AgendaItemType, AgendaOutcome[]> = {
  [AgendaItemType.CALL]: [AgendaOutcome.CONTACTED, AgendaOutcome.NO_ANSWER, AgendaOutcome.WRONG_NUMBER],
  [AgendaItemType.WHATSAPP]: [AgendaOutcome.CONTACTED, AgendaOutcome.NO_ANSWER, AgendaOutcome.WRONG_NUMBER],
  [AgendaItemType.VISIT]: [AgendaOutcome.CONTACTED, AgendaOutcome.NOT_FOUND, AgendaOutcome.WRONG_ADDRESS],
  [AgendaItemType.PROMISE_TO_PAY]: [AgendaOutcome.PROMISE_KEPT, AgendaOutcome.PROMISE_BROKEN],
  [AgendaItemType.REMINDER]: [AgendaOutcome.DONE],
};

/** Pasos fijos del botón "Posponer para luego" (Figma). Minutos. */
export const AGENDA_POSTPONE_STEPS = [15, 30, 60] as const;
export type AgendaPostponeStep = (typeof AGENDA_POSTPONE_STEPS)[number];

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
  WHATSAPP_TEMPLATE = 'WHATSAPP_TEMPLATE', // plantillas de mensaje (metadata.body con {{cliente}}/{{saldo}})
}
