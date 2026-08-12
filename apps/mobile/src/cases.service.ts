/**
 * Casos de cobranza (solo lectura). Thin sobre `apiQuery`; base de Agenda, Gestiones, Rutas y de la
 * lista de cartera (§5.3). El tipo refleja el `select` real de `cases.serializer.ts`: el listado SÍ trae
 * nombre de deudor, monto, cuota y próxima fecha; con `view=portfolio` suma zona, documento enmascarado
 * y promesa vigente.
 */
import type { CaseDetail, CaseListItem, CaseStatus, NewActivity } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';
import { cachedList, cachedOne } from './sync/cached';

/**
 * Los tipos del contrato viven en `@kobrax/shared` (F9 W5): los consume también el panel web.
 * Acá se re-exportan para que las pantallas sigan importando de un solo lado.
 */
export type {
  ActivityPromise,
  CaseActivityItem,
  CaseDetail,
  CaseListItem,
  NewActivity,
  PortfolioLocation,
} from '@kobrax/shared';

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
  const query = toQuery({
    ...params,
    overdue: params.overdue ? 'true' : undefined,
    open: params.open ? 'true' : undefined,
  });
  // La query ES la clave del respaldo local: cada combinación de filtros guarda su propia
  // respuesta, porque quien decide qué casos entran es el servidor (P6 · `sync/cached.ts`).
  return cachedList<CaseListItem>('case', query || 'all', () => apiQuery<CaseListItem[]>(`/cases${query}`));
}

export function getCase(id: string): Promise<QueryResult<CaseDetail>> {
  return cachedOne<CaseDetail>('case.detail', id, () => apiQuery<CaseDetail>(`/cases/${id}`));
}

/** Registrar una gestión (o el auto-log de Llamar/WhatsApp/Navegar). */
export function addActivity(caseId: string, input: NewActivity): Promise<MutateResult<{ id: string; type: string; createdAt: string }>> {
  return apiMutate(`/cases/${caseId}/activities`, 'POST', input);
}
