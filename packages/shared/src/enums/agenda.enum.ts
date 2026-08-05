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

/**
 * En qué horas cae cada franja (`from` inclusive, `to` exclusivo, salvo NIGHT que cierra el día).
 *
 * Vive acá porque lo usan **los dos lados**: la API agrupa por franja las gestiones de hora fija
 * (`slotOfTime`) y el móvil pinta el rango legible del chip. Con la frontera duplicada, el chip
 * podría decir una franja distinta de la que la API contó.
 */
export const TIME_SLOT_HOURS: Record<AgendaTimeSlot, { from: number; to: number }> = {
  [AgendaTimeSlot.MORNING]: { from: 8, to: 12 },
  [AgendaTimeSlot.AFTERNOON]: { from: 12, to: 18 },
  [AgendaTimeSlot.NIGHT]: { from: 18, to: 24 },
};

/**
 * A qué franja pertenece una hora `HH:mm`. Todo lo anterior a la mañana (una gestión de madrugada)
 * cae en `MORNING`: es la primera del día, no una cuarta franja.
 */
export function slotOfTime(hhmm: string): AgendaTimeSlot {
  const hour = Number(hhmm.slice(0, 2));
  if (!Number.isFinite(hour)) return AgendaTimeSlot.MORNING;
  if (hour >= TIME_SLOT_HOURS[AgendaTimeSlot.NIGHT].from) return AgendaTimeSlot.NIGHT;
  if (hour >= TIME_SLOT_HOURS[AgendaTimeSlot.AFTERNOON].from) return AgendaTimeSlot.AFTERNOON;
  return AgendaTimeSlot.MORNING;
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
  SPECIAL_CATEGORY = 'SPECIAL_CATEGORY', // categorías de "gestión especial" en campo (RT-6)
}
