/**
 * Gestiones agendadas (lectura — S1). Thin sobre `apiQuery`. Tipos verificados contra
 * `agenda.serializer.ts` del API (fechas llegan como ISO string vía JSON).
 */
import type { AgendaItemStatus, AgendaItemType, ScheduleTimeMode } from '@kobrax/shared';
import { apiQuery, toQuery, type QueryResult } from './api-client';

export interface AgendaListItem {
  id: string;
  caseId: string;
  clientId: string;
  creditId: string;
  assigneeId: string;
  type: AgendaItemType;
  status: AgendaItemStatus;
  priorityCode?: string;
  expectedResultCode?: string;
  scheduledDate: string;
  timeMode: ScheduleTimeMode;
  scheduledTime?: string;
  timeSlot?: string;
  observations?: string;
  details: Record<string, unknown>;
  resultActivityId?: string;
  clientName?: string;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Agendados de un día (`YYYY-MM-DD`). El móvil separa secciones por `status`. */
export function listByDay(dateISO: string): Promise<QueryResult<AgendaListItem[]>> {
  return apiQuery<AgendaListItem[]>(`/agenda${toQuery({ date: dateISO })}`);
}

/** Vencidos (SCHEDULED con fecha < hoy), desc. `total` = `meta.total` (para "ver más"). */
export function listOverdue(limit = 100): Promise<QueryResult<AgendaListItem[]>> {
  return apiQuery<AgendaListItem[]>(`/agenda/overdue${toQuery({ limit })}`);
}
