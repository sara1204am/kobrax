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
  QUARTERLY = 'QUARTERLY',
  SEMIANNUAL = 'SEMIANNUAL',
  ANNUAL = 'ANNUAL',
}

/**
 * Las frecuencias que las pantallas ofrecen hoy. Las trimestral/semestral/anual ya las entiende el
 * motor, pero **no se ofrecen** hasta que salga el móvil que las conoce: una versión vieja lee un
 * valor desconocido como `MONTHLY` (`readCreditMetadata`) y cobraría en la fecha equivocada.
 */
export const OFFERED_FREQUENCIES: readonly PaymentFrequency[] = [
  PaymentFrequency.DAILY,
  PaymentFrequency.WEEKLY,
  PaymentFrequency.BIWEEKLY,
  PaymentFrequency.MONTHLY,
];

/**
 * Cómo se definió el crédito (F4/06 · D1). Decide también **quién manda** en la cuota (D14):
 * calculado → el motor; cuota acordada → la cuota del usuario; total acordado → el total del usuario.
 */
export enum CreditDefinition {
  CALCULATED = 'calculated',
  AGREED_INSTALLMENT = 'agreed_installment',
  AGREED_TOTAL = 'agreed_total',
}

/** Tipo de interés (D2). Es un eje distinto del método de amortización: francés NO es "compuesto". */
export enum InterestType {
  SIMPLE = 'simple',
  COMPOUND = 'compound',
}

/** Método de amortización (D3). Pago único es un método, no una frecuencia (D5). */
export enum AmortizationMethod {
  FIXED_INSTALLMENT = 'fixed_installment',
  FIXED_PRINCIPAL = 'fixed_principal',
  SINGLE_PAYMENT = 'single_payment',
}

/**
 * Qué representa `credits.outstanding_balance` (F4/06 · D15). Se guarda en `metadata.balanceBasis`
 * **sólo cuando se sabe**; nunca se estampa una suposición.
 *
 *  · `total`     — saldo TOTAL pendiente de cobro (capital + interés/ganancia). La regla desde D15.
 *  · `principal` — el saldo es el capital: sólo el préstamo abierto, cuyo total nadie conoce (D16).
 *
 * El saldo de CAPITAL es otro concepto y no vive en esa columna: se deriva del plan de pagos.
 */
export const BALANCE_BASES = ['total', 'principal'] as const;
export type BalanceBasis = (typeof BALANCE_BASES)[number];
/** La base efectiva: `legacy` = crédito manual anterior a D15, sin marca (ver la estrategia de migración). */
export type EffectiveBalanceBasis = BalanceBasis | 'legacy';

/** Forma de pago de un total acordado: todo junto o repartido en cuotas. */
export enum RepaymentForm {
  SINGLE = 'single',
  INSTALLMENTS = 'installments',
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

/**
 * **A qué período se refiere el porcentaje de interés** (F4/06 · D17), independiente de la frecuencia
 * de pago. El banco dice «18 % anual» y se paga mensual; el prestamista, «5 % mensual» y cobra semanal.
 * El motor lo convierte a la tasa de cada cuota (`periodicRatePercent`). Ausente = por cuota (como antes).
 */
export enum RatePeriod {
  PER_INSTALLMENT = 'per_installment',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  SEMIANNUAL = 'semiannual',
  ANNUAL = 'annual',
}

/**
 * Cómo se convierte una tasa de otro período a la de la cuota (D17):
 *  · `nominal` (default) — proporcional: 18 % anual pagando mensual = 18/12 = 1,5 % por mes;
 *  · `effective` — la tasa ya capitaliza (TEA): (1 + 18 %)^(1/12) − 1 ≈ 1,389 % por mes.
 */
export enum RateConvention {
  NOMINAL = 'nominal',
  EFFECTIVE = 'effective',
}

/**
 * Cuándo se cobra un cargo (F4/06 · D18):
 *  · `per_installment` — un monto fijo en cada cuota (gastos de cobranza);
 *  · `first_installment` — una vez, en la primera cuota (comisión de apertura, fija o % del monto);
 *  · `deducted` — se descuenta del desembolso: no toca las cuotas, se entrega menos.
 */
export enum ChargeTiming {
  PER_INSTALLMENT = 'per_installment',
  FIRST_INSTALLMENT = 'first_installment',
  DEDUCTED = 'deducted',
}

/** En qué se expresa el plazo en pantalla (D17). Se guarda siempre convertido a número de cuotas. */
export enum TermUnit {
  INSTALLMENTS = 'installments',
  MONTHS = 'months',
  YEARS = 'years',
}

/**
 * Períodos de pago por año, para convertir tasas y plazos (D17). Quincenal = 26 porque el
 * calendario avanza de a 14 días (`addPeriods`); diario = 360, la convención bancaria.
 */
export const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  [PaymentFrequency.DAILY]: 360,
  [PaymentFrequency.WEEKLY]: 52,
  [PaymentFrequency.BIWEEKLY]: 26,
  [PaymentFrequency.MONTHLY]: 12,
  [PaymentFrequency.QUARTERLY]: 4,
  [PaymentFrequency.SEMIANNUAL]: 2,
  [PaymentFrequency.ANNUAL]: 1,
};

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
