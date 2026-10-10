/**
 * Contexto de ingreso del deudor (F4/13 · capa de datos para la IA).
 *
 * Son datos **opcionales**: ninguna regla puede asumir que existen. Se guardan para que la aplicación pueda,
 * con reglas deterministas, no insistir antes de que le llegue el dinero a alguien con ingreso trimestral.
 */

/** Cada cuánto le llega el dinero. `SEASONAL` = por temporada (cosecha); `IRREGULAR` = sin ritmo fijo. */
export enum IncomeCycle {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEASONAL = 'SEASONAL',
  IRREGULAR = 'IRREGULAR',
}

export const INCOME_CYCLES: readonly IncomeCycle[] = Object.values(IncomeCycle);

/**
 * Códigos del catálogo `INCOME_SOURCE`. Son fijos porque **filtran qué motivos de no pago se ofrecen**
 * (`NO_PAYMENT_REASON.metadata.appliesTo`); el texto que ve el usuario sí lo edita cada cuenta.
 */
export const INCOME_SOURCE_CODES = ['EMPLOYEE', 'BUSINESS', 'OTHER'] as const;
export type IncomeSourceCode = (typeof INCOME_SOURCE_CODES)[number];

/** De dónde salió un dato de contexto: para saber cuánto fiarse de él y, más adelante, aprender de las correcciones. */
export enum DataOrigin {
  MANUAL = 'MANUAL',
  DICTATION = 'DICTATION',
  IMPORT = 'IMPORT',
  SUGGESTION_ACCEPTED = 'SUGGESTION_ACCEPTED',
}
