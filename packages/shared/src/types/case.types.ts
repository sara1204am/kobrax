/**
 * Contrato de los casos de cobranza (`/cases`).
 *
 * Vive acá porque lo consumen el móvil y el panel web, y la forma está verificada contra
 * `serializeCase` de la API (las fechas llegan como ISO string vía JSON).
 */
import type { CasePriority, CaseStatus } from '../enums/index.js';
import type { CreditOrigin, PaymentFrequency } from '../enums/credit.enum.js';

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
  isOverdue: boolean;
  /** Enriquecidos por el backend en el listado (ausentes en respuestas de mutación). */
  clientName?: string;
  amount?: number;
  currency?: string;
  /** Días de mora calculados por el server (no por el reloj del dispositivo). */
  daysPastDue?: number;
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
