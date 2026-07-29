/**
 * Casos de cobranza (solo lectura). Thin sobre `apiQuery`; base de Agenda, Gestiones, Rutas y de la
 * lista de cartera (§5.3). El tipo refleja el `select` real de `cases.serializer.ts`: el listado SÍ trae
 * nombre de deudor, monto, cuota y próxima fecha; con `view=portfolio` suma zona, documento enmascarado
 * y promesa vigente.
 */
import type { CasePriority, CaseStatus, CreditOrigin, PaymentFrequency } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';

/**
 * Un punto del cliente en el mapa. `ownerName` presente ⇒ la ubicación es de un garante o familiar,
 * no del cliente: una deuda se cobra donde esté la persona.
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

/** Forma verificada contra `serializeCase` (fechas llegan como ISO string vía JSON). */
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
  /** Cuota/próxima fecha del crédito (fundación: `creditView`). */
  installmentAmount?: number;
  nextDueDate?: string;
  frequency?: PaymentFrequency;
  origin?: CreditOrigin;
  locked?: boolean;
  /** Solo con `view=portfolio` (§5.3). */
  zone?: string;
  /** Todas las ubicaciones dibujables: las del cliente y las de sus garantes/familiares. */
  locations?: PortfolioLocation[];
  documentMasked?: string;
  hasActivePromise?: boolean;
  lastActionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListCasesParams {
  assigneeId?: string;
  status?: CaseStatus;
  overdue?: boolean;
  /** Solo casos abiertos (excluye CLOSED/WRITTEN_OFF) — para el KPI de carga del día. */
  open?: boolean;
  /** 'portfolio' → enriquece la respuesta para la lista de cartera (§5.3). */
  view?: 'portfolio';
  page?: number;
  limit?: number;
}

export function listCases(params: ListCasesParams): Promise<QueryResult<CaseListItem[]>> {
  // `overdue`/`open` viajan como 'true'/'false' (el DTO del API los valida como string, no boolean).
  return apiQuery<CaseListItem[]>(
    `/cases${toQuery({
      ...params,
      overdue: params.overdue ? 'true' : undefined,
      open: params.open ? 'true' : undefined,
    })}`,
  );
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

/** Detalle del caso para la ficha (§5.4): campos de la lista + el historial de gestiones. */
export interface CaseDetail extends CaseListItem {
  activities?: CaseActivityItem[];
}

export function getCase(id: string): Promise<QueryResult<CaseDetail>> {
  return apiQuery<CaseDetail>(`/cases/${id}`);
}

/** Promesa de pago de una gestión (§5.4): crea también un agenda_item PROMISE_TO_PAY. */
export interface ActivityPromise {
  amount: number;
  promiseDate: string; // ISO YYYY-MM-DD
  paymentMethodCode: string;
  bankCode?: string;
}

export interface NewActivity {
  type: 'NOTE' | 'CALL' | 'VISIT' | 'MESSAGE';
  result?: string;
  notes?: string;
  promise?: ActivityPromise;
}

/** Registrar una gestión (o el auto-log de Llamar/WhatsApp/Navegar). */
export function addActivity(caseId: string, input: NewActivity): Promise<MutateResult<{ id: string; type: string; createdAt: string }>> {
  return apiMutate(`/cases/${caseId}/activities`, 'POST', input);
}
