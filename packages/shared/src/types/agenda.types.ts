/**
 * Contrato de la agenda (`/agenda`).
 *
 * Vive acá porque lo consumen el móvil y el panel web, y la API tiene su propio serializador del
 * otro lado del cable (`apps/api/src/modules/agenda/agenda.serializer.ts`): son los mismos nombres
 * a los dos lados. Verificado contra ese serializador — las fechas llegan como ISO string.
 */
import type { AgendaItemStatus, AgendaItemType, ScheduleTimeMode } from '../enums/agenda.enum.js';
import type { AgendaDetails } from '../validation/agenda-details.js';

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
  /** Motivo del desenlace no ejecutado: cancelación si está CANCELLED, reprogramación si RESCHEDULED. */
  reasonCode?: string;
  /** El agendado del que nació al reagendar — con esto se arma la cadena en el historial. */
  rescheduledFromId?: string;
  clientName?: string;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Con qué se ejecuta la gestión: el teléfono al que llamar o la dirección a la que ir. */
export interface AgendaTarget {
  phone?: string;
  address?: string;
  zone?: string;
  latitude?: number;
  longitude?: number;
}

/** Una fila del historial de gestiones del caso. */
export interface AgendaHistoryEntry {
  id: string;
  type: AgendaItemType;
  status: AgendaItemStatus;
  scheduledDate: string;
  isOverdue: boolean;
  reasonCode?: string;
  rescheduledFromId?: string;
}

/**
 * Detalle de una gestión: un round-trip con la gestión, el deudor, el saldo, el dato de contacto y
 * el historial.
 *
 * ⚠️ Revela el documento del deudor **en claro** y lo audita: se pide sólo al abrir el detalle,
 * nunca para pintar una lista.
 */
export interface AgendaItemDetail {
  item: AgendaListItem;
  client: { id: string; displayName: string; nationalId: string | null; zone?: string };
  credit?: { creditId: string; code?: string; outstandingBalance: number; currency: string; daysPastDue: number };
  /** Ausente en recordatorios y promesas: no hay a quién llamar ni a dónde ir. */
  target?: AgendaTarget;
  /** `code` → etiqueta del catálogo (medio de pago, banco). Sólo en promesas de pago. */
  labels?: Record<string, string>;
  history: AgendaHistoryEntry[];
}

export interface CreateAgendaInput {
  caseId: string;
  creditId: string;
  type: AgendaItemType;
  scheduledDate: string;
  timeMode: ScheduleTimeMode;
  scheduledTime?: string;
  timeSlot?: string;
  observations?: string;
  details: AgendaDetails;
}

/**
 * Cuerpo de `PATCH /agenda/:id`. **Sin `scheduledDate` ni deudor**: mover el día es reagendar
 * (deja rastro) y el cliente es el ancla del agendado. Se manda sólo lo que cambió.
 */
export interface UpdateAgendaInput {
  type?: AgendaItemType;
  timeMode?: ScheduleTimeMode;
  scheduledTime?: string;
  timeSlot?: string;
  observations?: string;
  details?: AgendaDetails;
}
