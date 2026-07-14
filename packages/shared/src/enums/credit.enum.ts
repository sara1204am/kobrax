/**
 * Enums del crédito operativo (spec `docs/flows/Cliente_Prestamo.pdf`).
 * Ninguno es columna: viven dentro de `credit.metadata` (JSONB) o son derivados.
 */

/** Frecuencia de pago (§4.1, chips del formulario). El gota a gota necesita DAILY. */
export enum PaymentFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
}

/**
 * Origen del dato (§3). Un crédito con origen distinto de `manual` tiene los campos financieros
 * bloqueados en la UI y **su mora la manda la fuente**, no el recálculo (§6).
 */
export enum CreditOrigin {
  MANUAL = 'manual',
  QUICK_BATCH = 'quick_batch',
  IMPORT = 'import',
  API = 'api',
}

/** Base de cálculo del interés en el Modo B (§4.2). Default: por período, "la convención dominante". */
export enum InterestBase {
  PER_PERIOD = 'PER_PERIOD',
  TOTAL = 'TOTAL',
}

/**
 * Estado derivado de la cartera (§5.3). **Se calcula, nunca se edita** — deriva de `daysPastDue`,
 * `nextDueDate`, el saldo y las promesas vigentes.
 */
export enum PortfolioStatus {
  CURRENT = 'CURRENT', // AL DÍA — sin cuota vencida y próxima fecha > umbral
  DUE_SOON = 'DUE_SOON', // POR VENCER — próxima cuota en ≤ umbral
  OVERDUE = 'OVERDUE', // EN MORA — daysPastDue > 0
  PROMISE = 'PROMISE', // PROMESA — compromiso de pago vigente
  PAID = 'PAID', // PAGADO — saldo 0
}

/** Umbral por defecto de "POR VENCER" en días (§5.3: "≤ 3 días, configurable por tenant"). */
export const DUE_SOON_DAYS = 3;
