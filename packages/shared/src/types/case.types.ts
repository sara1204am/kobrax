/**
 * Contrato de los casos de cobranza (`/cases`).
 *
 * Vive acá porque lo consumen el móvil y el panel web, y la forma está verificada contra
 * `serializeCase` de la API (las fechas llegan como ISO string vía JSON).
 */
import type { CasePriority, CaseStatus } from '../enums/index.js';
import type { ArrearsSource, CreditOrigin, PaymentFrequency } from '../enums/credit.enum.js';

/**
 * Cómo se puede ordenar `GET /cases`. La primera es el default.
 *
 * Vive acá porque es contrato: la API decide qué sabe ordenar y el panel decide qué columnas
 * ofrece. Con una copia a mano en cada lado, agregar una clave allá y olvidarla acá deja una
 * flecha de orden que no ordena nada — y sacarla allá, un 500 esperando a que alguien la use.
 */
export const CASE_SORTS = ['priority', 'daysPastDue', 'balance', 'slaDueAt', 'createdAt'] as const;
export type CaseSort = (typeof CASE_SORTS)[number];

/**
 * Un punto del cliente en el mapa. `ownerName` presente ⇒ la ubicación es de un garante o
 * familiar, no del cliente: una deuda se cobra donde esté la persona.
 */
export interface PortfolioLocation {
  id: string;
  locationType: string;
  latitude: number;
  longitude: number;
  address?: string;
  ownerName?: string;
  ownerRelation?: string;
}

export interface CaseListItem {
  id: string;
  creditId: string;
  clientId: string;
  branchId?: string;
  assigneeId?: string;
  status: CaseStatus;
  priority: CasePriority;
  slaDueAt?: string;
  /**
   * La prioridad la fijó una persona: **el trabajo diario no la recalcula**. Tiene que verse, o un
   * préstamo de 200 días en prioridad baja parece un cálculo roto en vez de una decisión.
   */
  priorityPinned?: boolean;
  isOverdue: boolean;
  /** Enriquecidos por el backend en el listado (ausentes en respuestas de mutación). */
  clientName?: string;
  amount?: number;
  currency?: string;
  /** Días de mora calculados por el server (no por el reloj del dispositivo). */
  daysPastDue?: number;
  /** Código del préstamo: dos créditos del mismo deudor se distinguen por esto. */
  creditCode?: string;
  /**
   * De dónde sale `daysPastDue`. Dice **cuánto confiar en él**: la calculada la mantiene el trabajo
   * diario, la del archivo vale hasta la próxima importación, la marcada a mano la puso una persona.
   */
  arrearsSource?: ArrearsSource;
  /** Cuota/próxima fecha del crédito (`creditView`). */
  installmentAmount?: number;
  nextDueDate?: string;
  frequency?: PaymentFrequency;
  origin?: CreditOrigin;
  locked?: boolean;
  /** Sólo con `view=portfolio`. */
  zone?: string;
  /** Todas las ubicaciones dibujables: las del cliente y las de sus garantes/familiares. */
  locations?: PortfolioLocation[];
  documentMasked?: string;
  hasActivePromise?: boolean;
  lastActionAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Una gestión del historial del caso (`serializeActivity`). */
export interface CaseActivityItem {
  id: string;
  type: string;
  result?: string;
  notes?: string;
  userId?: string;
  createdAt: string;
}

/** Detalle del caso: los campos de la lista + el historial de gestiones. */
export interface CaseDetail extends CaseListItem {
  activities?: CaseActivityItem[];
}

/** Promesa de pago de una gestión: crea también un `agenda_item` de tipo `PROMISE_TO_PAY`. */
export interface ActivityPromise {
  amount: number;
  /** ISO `YYYY-MM-DD`. */
  promiseDate: string;
  paymentMethodCode: string;
  bankCode?: string;
}

export interface NewActivity {
  type: 'NOTE' | 'CALL' | 'VISIT' | 'MESSAGE';
  result?: string;
  notes?: string;
  promise?: ActivityPromise;
}
