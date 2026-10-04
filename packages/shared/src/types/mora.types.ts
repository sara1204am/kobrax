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
import type { CreditAssignmentKind, MoraSituation } from './sin-caso.types.js';
import type { CreditOrigin, PaymentFrequency } from '../enums/credit.enum.js';
import type { PortfolioLocation } from './case.types.js';

/**
 * Cómo se puede ordenar `GET /mora`. La primera es el default.
 *
 * @deprecated `lastAction` y `slaDueAt` ya no ordenan nada (F4/08 · D2): la API las trata como clave
 * desconocida (cae al default). Siguen en la tupla sólo para que web/móvil compilen hasta la fase 3/4.
 *
 * Sólo claves que Postgres puede ordenar sin calcular nada por fila: el monto vencido, la próxima
 * fecha y el inicio de mora viven en el JSON de `credits.metadata` o salen de las cuotas, así que
 * son columnas para mirar y no para ordenar.
 */
export const MORA_SORTS = ['daysPastDue', 'balance', 'priority', 'lastAction', 'slaDueAt', 'createdAt'] as const;
export type MoraSort = (typeof MORA_SORTS)[number];

/** De dónde sale `overdueAmount`: del cronograma (propios) o de lo que reportó el archivo (importados). */
export type OverdueSource = 'SCHEDULE' | 'REPORTED';

/**
 * El caso abierto que gestiona el crédito.
 * @deprecated F4/08: ya no existe el caso en la lista de mora; la API nunca lo llena. Se borra en la fase 6.
 */
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

/** La categoría de mora de un crédito, tal como la configuró la cuenta. */
export interface MoraCategoryTag {
  code: string;
  name: string;
  color?: string;
}

/** Quién atiende el crédito además del responsable: reemplazo temporal o apoyo vigentes. */
export interface MoraAssignment {
  /** Id de la fila de `credit_assignments` (para revocar). Ausente en el responsable principal. */
  id?: string;
  kind: CreditAssignmentKind;
  userId: string;
  /** ISO. Ausente = no vence por fecha. */
  expiresAt?: string;
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
  /** `YYYY-MM-DD`: desde cuándo ya no aparece en el reporte (D9). Sólo con `syncStatus = ABSENT`. */
  absentSince?: string;
  /** El corte tiene más días que el umbral del formato (D9). */
  reportedStale?: boolean;
  /** Etiqueta de estado que trajo el archivo. Opcional: sólo importados que la mapearon. */
  reportedStatus?: string;

  // ── Gestión ─────────────────────────────────────────────────────────────────
  branchId?: string;
  branchName?: string;
  /** @deprecated F4/08: la API nunca lo llena (no hay caso). Usar `priority`, `responsibleId` y `lastActionAt`. */
  case?: MoraCaseSummary;

  // ── Modelo sin caso (F4/08) ─────────────────────────────────────────────────
  /** Al día / En mora: se deriva del episodio de mora abierto. Nadie la edita. */
  situation: MoraSituation;
  /** Categoría de mora (A/B/C…): se CALCULA con los días y los rangos de la cuenta. Ausente = al día o la cuenta no tiene categorías. */
  category?: MoraCategoryTag;
  /** Castigado (`credits.written_off_at`): condición aparte; puede estar en mora y castigado. */
  writtenOff: boolean;
  /** Prioridad del episodio de mora ABIERTO. Ausente = al día. */
  priority?: CasePriority;
  /** La prioridad la fijó una persona (el recálculo no la pisa). */
  priorityPinned: boolean;
  /** El responsable del crédito (`credits.assigned_manager_id`). Ausente = sin responsable. */
  responsibleId?: string;
  /** Última gestión (`credits.last_action_at`), ISO. Sólo informativo: no es estado ni filtro. */
  lastActionAt?: string;
  /** Resultado/tipo de la última gestión del crédito. */
  lastActivityType?: string;
  lastActivityResult?: string;
  hasActivePromise: boolean;

  // ── Cartera / rutas (F4/08 fase 5): lo que antes traía `CaseListItem` con `view=portfolio` ─────────────
  /**
   * Mapeo `CaseListItem` → `MoraCreditListItem` (para reconstruir `groupPortfolio` desde `GET /mora?todos=true`):
   *   id / creditId → creditId            · clientId, branchId, clientName, currency → igual
   *   assigneeId → responsibleId          · creditCode → code
   *   amount → balance (ausente = el archivo no lo trajo; groupPortfolio usa `?? 0`)
   *   daysPastDue, arrearsSource, installmentAmount, nextDueDate, externalSource, syncStatus, reportedAsOf,
   *   reportedStale, suggestedPaymentAmount, hasActivePromise, lastActionAt, priority, priorityPinned → igual
   *   status → situation (+ writtenOff) · isOverdue → situation === 'IN_ARREARS' (o daysPastDue > 0)
   *   zone, locations, documentMasked, frequency, origin, locked → NUEVOS aquí (misma forma y regla que el caso)
   *   slaDueAt, createdAt, updatedAt → no existen. `portfolioStatus` y `creditCount` los calcula el cliente
   *   (`portfolioStatus` de shared con balance/daysPastDue/nextDueDate/hasActivePromise; count = filas por clientId).
   */
  /** Zona de la ubicación primaria DEL CLIENTE (la primera HOME; si no, la primera cargada). Sólo en la lista. */
  zone?: string;
  /** Todas las ubicaciones dibujables (con punto): las del cliente y las de sus garantes/familiares. Sólo en la lista. */
  locations?: PortfolioLocation[];
  /** Documento del deudor, siempre enmascarado. Sólo en la lista. */
  documentMasked?: string;
  frequency?: PaymentFrequency;
  origin?: CreditOrigin;
  /** Candado del dato importado (campos financieros no editables). */
  locked?: boolean;
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
  /** Las asignaciones vigentes del crédito: PRINCIPAL, TEMPORAL (con vencimiento) y APOYO. */
  assignments: MoraAssignment[];
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

/** Los colores del post-it (la paleta de post-its de Kobrax). Es el color de la nota; el tipo (`MORA_NOTE_KINDS`) es otra cosa. */
export const MORA_NOTE_COLORS = ['YELLOW', 'PINK', 'BLUE', 'GREEN', 'PURPLE', 'ORANGE'] as const;
export type MoraNoteColor = (typeof MORA_NOTE_COLORS)[number];

/**
 * La sección de la ficha a la que se ancla un post-it: `x`/`y` son píxeles **dentro de ella**, así que la nota
 * viaja con la sección (scroll, plegar, cambiar de ancho). `PAGE` es la ficha entera.
 */
export const MORA_NOTE_ANCHORS = ['PAGE', 'TIMELINE', 'PROMISES', 'NOTES', 'PAYMENTS', 'HISTORY', 'PERSON'] as const;
export type MoraNoteAnchor = (typeof MORA_NOTE_ANCHORS)[number];

/** Tamaño del post-it en el tablero (px). La base lo vuelve a exigir (`credit_notes_tablero`). */
export const NOTE_BOARD_LIMITS = { minWidth: 160, maxWidth: 520, minHeight: 120, maxHeight: 440, defaultWidth: 240, defaultHeight: 180 } as const;

/** Una nota sobre un crédito, independiente del caso (`GET /mora/:creditId/notes`). Es un post-it sobre el tablero de la ficha. */
export interface CreditNote {
  id: string;
  creditId: string;
  kind: MoraNoteKind;
  body: string;
  color: MoraNoteColor;
  /** Sección de la ficha a la que está anclada (`x`/`y` se miden desde su esquina). */
  anchor: MoraNoteAnchor;
  /** Lugar en el tablero: esquina superior izquierda, tamaño y orden de apilado (más alto = encima). */
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  authorId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Crear una nota. `id` es opcional y **lo puede traer quien escribe** (el móvil, sin red): reintentar con el
 * mismo id no duplica la nota. Sin lugar, el servidor la pone en cascada; el orden de apilado lo pone siempre él.
 */
export interface NewCreditNote {
  id?: string;
  kind?: MoraNoteKind;
  body: string;
  color?: MoraNoteColor;
  anchor?: MoraNoteAnchor;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** Editar una nota: sólo lo que viene cambia. `front` la trae al frente del tablero. */
export interface UpdateCreditNote {
  kind?: MoraNoteKind;
  body?: string;
  color?: MoraNoteColor;
  /** Pasarla a otra sección: va junto con el `x`/`y` nuevos, medidos desde esa sección. */
  anchor?: MoraNoteAnchor;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  front?: boolean;
}
