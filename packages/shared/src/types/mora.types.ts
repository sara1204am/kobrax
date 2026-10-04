/**
 * Contrato de la Central de Mora (`GET /mora`): **una fila por crédito en mora**.
 *
 * Es el contrato que consumen el panel web y, después, el móvil. La mora, el monto vencido y la
 * prioridad los calcula el backend; ningún cliente los recalcula (F4/07 §4).
 *
 * 🔴 **Ausente ≠ cero.** Un importado puede no traer el capital, la cuota, el último pago o el monto
 * vencido (el formato del archivo decide qué columnas mapea), y un crédito propio sin cronograma no
 * tiene monto vencido calculable. Todo lo opcional llega `undefined` y la pantalla muestra «—»; un 0
 * inventado haría pasar un dato desconocido por uno conocido.
 */
import type { CasePriority, CaseStatus } from '../enums/index.js';
import type { ArrearsSource, ExternalSyncStatus } from '../enums/credit.enum.js';

/**
 * Cómo se puede ordenar `GET /mora`. La primera es el default.
 *
 * Sólo claves que Postgres puede ordenar sin calcular nada por fila: el monto vencido, la próxima
 * fecha y el inicio de mora viven en el JSON de `credits.metadata` o salen de las cuotas, así que
 * son columnas para mirar y no para ordenar.
 */
export const MORA_SORTS = ['daysPastDue', 'balance', 'priority', 'lastAction', 'slaDueAt', 'createdAt'] as const;
export type MoraSort = (typeof MORA_SORTS)[number];

/** De dónde sale `overdueAmount`: del cronograma (propios) o de lo que reportó el archivo (importados). */
export type OverdueSource = 'SCHEDULE' | 'REPORTED';

/** El caso abierto que gestiona el crédito. Ausente = el crédito está en mora pero nadie abrió caso. */
export interface MoraCaseSummary {
  id: string;
  status: CaseStatus;
  priority: CasePriority;
  /** La prioridad la fijó una persona: el trabajo diario no la recalcula. */
  priorityPinned: boolean;
  assigneeId?: string;
  slaDueAt?: string;
  isOverdue: boolean;
  lastActionAt?: string;
}

export interface MoraCreditListItem {
  creditId: string;
  /** Nº de crédito. Puede faltar en un crédito propio creado sin código. */
  code?: string;
  clientId: string;
  clientName?: string;
  currency: string;

  // ── Financiero ──────────────────────────────────────────────────────────────
  /** Saldo total. Ausente = el archivo importado no lo trajo. */
  balance?: number;
  /** Monto original. Ausente = desconocido (importado que no lo trajo). */
  principalAmount?: number;
  installmentAmount?: number;
  nextDueDate?: string;
  /** Con qué monto arranca el formulario de pago (`suggestedPaymentAmount`). Ausente = vacío. */
  suggestedPaymentAmount?: number;
  /** Lo realmente vencido (no el saldo total). Ver `overdueSource`. */
  overdueAmount?: number;
  overdueSource?: OverdueSource;
  /** `YYYY-MM-DD`: el mayor entre lo reportado por el archivo y los pagos registrados en Kobrax. */
  lastPaymentAt?: string;

  // ── Mora ────────────────────────────────────────────────────────────────────
  daysPastDue: number;
  arrearsSource: ArrearsSource;
  /** Sólo si alguien la declaró a mano. Un importado sólo trae días: no se estima. */
  moraSince?: string;
  /** Fuente externa del crédito (D1). Ausente = Kobrax. */
  externalSource?: string;
  syncStatus?: ExternalSyncStatus;
  reportedAsOf?: string;
  /** El corte tiene más días que el umbral del formato (D9). */
  reportedStale?: boolean;
  /** Etiqueta de estado que trajo el archivo. Opcional: sólo importados que la mapearon. */
  reportedStatus?: string;

  // ── Gestión ─────────────────────────────────────────────────────────────────
  branchId?: string;
  branchName?: string;
  case?: MoraCaseSummary;
  /** Resultado/tipo de la última gestión del caso abierto. */
  lastActivityType?: string;
  lastActivityResult?: string;
  hasActivePromise: boolean;
}

/** Filtros de `GET /mora` (todos opcionales; viajan en la URL de la pantalla). */
export interface MoraListQuery {
  page?: number;
  limit?: number;
  /** Nº de crédito, nombre/apellido/razón social o zona. */
  q?: string;
  dpdMin?: number;
  dpdMax?: number;
  /** `true` = incluye también los créditos al día (por defecto sólo `dpd >= 1`). */
  todos?: boolean;
  balanceMin?: number;
  balanceMax?: number;
  /** Uno o varios separados por coma. Son prioridades del **caso**. */
  priority?: string;
  /** Uno o varios separados por coma. Es el estado del **caso**, no del crédito. */
  status?: string;
  assigneeId?: string;
  /** `true` = casos sin cobrador. Sólo lo respeta quien ve toda la cartera. */
  unassigned?: boolean;
  hasCase?: boolean;
  branchId?: string;
  source?: 'KOBRAX' | 'PSF';
  arrearsSource?: ArrearsSource;
  hasPromise?: boolean;
  /** SLA del caso vencido. No es la mora. */
  overdue?: boolean;
  /** Sin gestión desde esa fecha (`YYYY-MM-DD`); incluye a quien nunca tuvo. */
  noActionSince?: string;
  zone?: string;
  sort?: MoraSort;
  dir?: 'asc' | 'desc';
}

/** Una gestión del caso abierto (la misma forma que `CaseActivityItem`). */
export interface MoraActivityItem {
  id: string;
  type: string;
  result?: string;
  notes?: string;
  userId?: string;
  createdAt: string;
}

/**
 * La ficha de recuperación de un crédito (`GET /mora/:creditId`): los mismos datos que la fila de la lista
 * más el historial de gestiones del caso abierto. Sin caso, `activities` viene vacío.
 */
export interface MoraCreditDetail extends MoraCreditListItem {
  activities: MoraActivityItem[];
}

/** `GET /mora/by-case/:caseId`: a qué crédito pertenece un caso, para que los enlaces viejos sigan abriendo. */
export interface MoraCaseLookup {
  creditId: string;
}

/** Cómo terminó una mora. `SOURCE_ABSENT` NO es una recuperación: sólo dice que la fuente dejó de reportarla. */
export const MORA_EPISODE_END_REASONS = ['PAID', 'CURRENT', 'SOURCE_ABSENT', 'WRITTEN_OFF', 'CANCELLED', 'DELETED'] as const;
export type MoraEpisodeEndReason = (typeof MORA_EPISODE_END_REASONS)[number];

/**
 * Un periodo de mora de un crédito (`GET /mora/:creditId/episodes`).
 *
 * 🔴 **Los episodios los mide el sistema desde que existe el historial; no se inventa el pasado.** Por eso
 * hay dos formas de «no sé»: `startedAtEstimated` (el inicio es una cuenta —corte menos días— y no una fecha
 * declarada) y `reconstructed` (salió de un caso cerrado antes del historial: no trae días máximos ni saldos).
 * Los campos opcionales llegan ausentes cuando nadie los midió, y la pantalla muestra «—», nunca 0.
 */
export interface MoraEpisode {
  id: string;
  /** Mora #n del crédito, en orden cronológico (el más antiguo es el #1). */
  number: number;
  /** `YYYY-MM-DD`. */
  startedAt: string;
  startedAtEstimated: boolean;
  /** Ausente = sigue en mora. */
  endedAt?: string;
  endReason?: MoraEpisodeEndReason;
  /** Días de mora al abrirse y el pico alcanzado. */
  startDaysPastDue?: number;
  maxDaysPastDue?: number;
  balanceAtStart?: number;
  balanceAtEnd?: number;
  source: ArrearsSource;
  reconstructed: boolean;
  /** Es el episodio abierto. */
  current: boolean;
  /** Días entre el inicio y el fin (o hoy, si sigue abierto). */
  durationDays: number;
}

// ── Promesas de pago ─────────────────────────────────────────────────────────────────────────────────────

/**
 * En qué está una promesa de pago.
 *
 *  · `ACTIVE` — agendada para hoy o adelante, sin ejecutar.
 *  · `OVERDUE` — la fecha pasó y nadie registró qué pasó. **No es incumplida**: no se sabe.
 *  · `KEPT` / `BROKEN` — alguien la ejecutó y dijo que pagó o que no.
 *  · `EXECUTED` — se ejecutó sin desenlace de promesa (dato viejo).
 *  · `CANCELLED` / `RESCHEDULED` — se canceló, o se movió a otra fecha (y la nueva es otra promesa).
 */
export const MORA_PROMISE_STATUSES = ['ACTIVE', 'OVERDUE', 'KEPT', 'BROKEN', 'EXECUTED', 'CANCELLED', 'RESCHEDULED'] as const;
export type MoraPromiseStatus = (typeof MORA_PROMISE_STATUSES)[number];

/** Una promesa de pago de un crédito (`GET /mora/:creditId/promises`). Vive en `agenda_items` (`PROMISE_TO_PAY`). */
export interface MoraPromise {
  id: string;
  /** Lo prometido. Ausente = la gestión no dijo cuánto. */
  amount?: number;
  /** `YYYY-MM-DD`: el día en que se comprometió a pagar. */
  promiseDate: string;
  status: MoraPromiseStatus;
  paymentMethodCode?: string;
  bankCode?: string;
  /** Quién la agendó / a quién le toca darle seguimiento. */
  assigneeId?: string;
  observations?: string;
  createdAt: string;
}

// ── Notas del crédito ────────────────────────────────────────────────────────────────────────────────────

export const MORA_NOTE_KINDS = ['INFO', 'WARNING', 'IMPORTANT'] as const;
export type MoraNoteKind = (typeof MORA_NOTE_KINDS)[number];
export const MORA_NOTE_MAX_LENGTH = 1000;

/** Una nota sobre un crédito, independiente del caso (`GET /mora/:creditId/notes`). */
export interface CreditNote {
  id: string;
  creditId: string;
  kind: MoraNoteKind;
  body: string;
  authorId?: string;
  createdAt: string;
}

/**
 * Crear una nota. `id` es opcional y **lo puede traer quien escribe** (el móvil, sin red): reintentar con el
 * mismo id no duplica la nota.
 */
export interface NewCreditNote {
  id?: string;
  kind?: MoraNoteKind;
  body: string;
}
