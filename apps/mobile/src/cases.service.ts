/**
 * Casos de cobranza (solo lectura). Thin sobre `apiQuery`; base de Agenda, Gestiones, Rutas y de la
 * lista de cartera (§5.3). El tipo refleja el `select` real de `cases.serializer.ts`: el listado SÍ trae
 * nombre de deudor, monto, cuota y próxima fecha; con `view=portfolio` suma zona, documento enmascarado
 * y promesa vigente.
 */
import type { CasePriority, CaseStatus, CreditOrigin, PaymentFrequency } from '@kobrax/shared';
import { apiQuery, toQuery, type QueryResult } from './api-client';

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
