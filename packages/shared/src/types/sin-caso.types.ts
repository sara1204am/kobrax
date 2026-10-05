/**
 * Contratos del modelo «sin caso» (F4/08): todo cuelga del crédito.
 *
 * Fechas como ISO string: son lo que
 * llega por JSON.
 */

// ── Actividad del crédito ───────────────────────────────────────────────────────────────────────

/**
 * Qué clase de gestión es. Espejo del enum `credit_activity_type` de la base. No hay cambio de estado: no hay estado que cambiar. Constante + unión (como `MORA_SORTS`) y no `enum` de TS.
 */
export const CREDIT_ACTIVITY_TYPES = ['NOTE', 'CALL', 'VISIT', 'PAYMENT', 'MESSAGE', 'ASSIGNMENT'] as const;
export type CreditActivityType = (typeof CREDIT_ACTIVITY_TYPES)[number];

/** Una fila de la bitácora del crédito (`credit_activities`). Append-only. */
export interface CreditActivity {
  /** Lo puede traer quien la crea (móvil offline): el mismo id no duplica. */
  id: string;
  creditId: string;
  clientId: string;
  /**
   * El episodio de mora vigente al escribirla. Ausente = acción preventiva (el crédito estaba al día).
   * El cliente no lo manda: lo resuelve el servidor.
   */
  episodeId?: string;
  /** Autor. */
  userId?: string;
  type: CreditActivityType;
  result?: string;
  notes?: string;
  createdAt: string;
}

// ── Prioridad (vive en el episodio abierto) ─────────────────────────────────────────────────────

export const COLLECTION_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type CollectionPriority = (typeof COLLECTION_PRIORITIES)[number];

// ── Categoría de mora (A / B / C…) ──────────────────────────────────────────────────────────────

/** Lo mínimo para ubicar un número de días en un rango. Lo cumplen `ArrearCategory` y sus borradores. */
export interface ArrearRange {
  /** Primer día de mora del rango, inclusive. Siempre >= 1. */
  fromDays: number;
  /** Último día, inclusive. `null` = sin límite: sólo la última categoría. */
  toDays: number | null;
}

/** Un rango de mora configurado en Administración (`arrear_categories`). La categoría de un crédito NO se guarda: se calcula. */
export interface ArrearCategory extends ArrearRange {
  id: string;
  /** Único por cuenta, no vacío. */
  code: string;
  name: string;
  color: string | null;
  sortOrder: number;
}

/** Una categoría todavía sin `id` (valores iniciales, formulario de edición). */
export type ArrearCategoryDraft = Omit<ArrearCategory, 'id'>;

// ── Asignación del crédito ──────────────────────────────────────────────────────────────────────

/**
 * Tipo de asignación (`credit_assignment_kind`): PRINCIPAL = el responsable (uno vigente por crédito);
 * TEMPORAL = reemplazo con vencimiento; APOYO = segundo cobrador. Los tres ven y trabajan el crédito.
 */
export const CREDIT_ASSIGNMENT_KINDS = ['PRINCIPAL', 'TEMPORAL', 'APOYO'] as const;
export type CreditAssignmentKind = (typeof CREDIT_ASSIGNMENT_KINDS)[number];

// ── Situación del crédito ───────────────────────────────────────────────────────────────────────

/** Al día o en mora. Se DERIVA del episodio abierto; nadie la edita ni la guarda. */
export const MORA_SITUATIONS = ['CURRENT', 'IN_ARREARS'] as const;
export type MoraSituation = (typeof MORA_SITUATIONS)[number];

/** La situación y, aparte, el castigo: pueden darse a la vez (240 días de mora y castigado). */
export interface MoraSituationResult {
  situation: MoraSituation;
  writtenOff: boolean;
}
