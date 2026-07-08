/**
 * Casos de cobranza (solo lectura en P1). Thin sobre `apiQuery`; base de Agenda (P1),
 * Gestiones (P2) y generación de rutas (P3). El tipo refleja el `select` real de
 * `cases.serializer.ts` — OJO: el listado NO trae nombre de deudor ni monto (solo IDs);
 * denormalizar eso es trabajo de backend / P2 (ver plan §12).
 */
import type { CasePriority, CaseStatus } from '@kobrax/shared';
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
