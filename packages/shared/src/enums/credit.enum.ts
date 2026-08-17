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

/**
 * Los estados que un crédito puede tener guardados (`CreditStatus` de la base).
 *
 * ⚠️ **No confundir con `PortfolioStatus`**, que está justo arriba y es lo contrario: aquél se
 * calcula de la mora y el saldo y nadie lo edita; éste es una columna que alguien elige. Los dos
 * tienen un `PAID` y significan cosas distintas.
 *
 * Es una lista y no un enum de TypeScript porque acá va la **regla** —cuáles hay y en qué orden se
 * ofrecen—, no el rótulo: eso lo pone cada app en su idioma.
 */
export const CREDIT_STATUSES = ['ACTIVE', 'PAID', 'DEFAULTED', 'RESTRUCTURED', 'WRITTEN_OFF', 'CANCELLED'] as const;

/**
 * De dónde salen los días de mora de un crédito. **Una mora, tres orígenes.**
 *
 * 🔴 **Cada origen tiene un solo dueño, y esa es toda la regla**: el trabajo diario nunca decide la
 * importada ni la manual, y una persona nunca edita a mano la calculada. Mezclar dueños produce el
 * ciclo de «lo puse al día y a la mañana volvió a mora», que es la forma más rápida de que quien
 * supervisa deje de creerle a la pantalla.
 *
 * No es una columna: se **deriva** de lo que ya hay (`arrearsSourceOf`), así que no puede quedar
 * desincronizada de los datos que la definen.
 */
export const ARREARS_SOURCES = ['CALCULATED', 'IMPORTED', 'MANUAL'] as const;
export type ArrearsSource = (typeof ARREARS_SOURCES)[number];

/**
 * Por qué se cerró un caso. Es texto libre en la base (`closed_reason`); acá viven **los que pone
 * el sistema**, que son los que después hay que poder contar.
 *
 * `PAID` y `CURRENT` los escribe el trabajo diario y **no exigen gestión registrada**: si el deudor
 * pagó por transferencia nunca hubo visita, y cobrado es cobrado. `MANUAL` es el cierre de una
 * persona desde la ficha, que sí la exige (`CASE_001`).
 */
export const CASE_CLOSE_REASONS = ['PAID', 'CURRENT', 'MANUAL'] as const;
export type CaseCloseReason = (typeof CASE_CLOSE_REASONS)[number];
