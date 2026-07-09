/**
 * Gestiones agendadas (lectura S1 + alta S2). Thin sobre `apiQuery`/`apiMutate`. Tipos verificados
 * contra `agenda.serializer.ts` del API (fechas llegan como ISO string vía JSON).
 */
import type { AgendaDetails, AgendaItemStatus, AgendaItemType, ScheduleTimeMode } from '@kobrax/shared';
import { apiMutate, apiQuery, toQuery, type MutateResult, type QueryResult } from './api-client';

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

/** Un crédito del cliente con caso abierto asignado a mí: lo que se puede agendar. */
export interface CreditOption {
  creditId: string;
  caseId: string;
  code?: string;
  /** Capital original del crédito. */
  principalAmount: number;
  outstandingBalance: number;
  /** Suma impaga de las cuotas vencidas; `0` si el crédito no tiene cronograma. */
  overdueAmount: number;
  currency: string;
  daysPastDue: number;
}

export interface ContactOption {
  id: string;
  contactType: string;
  /** En claro (el endpoint revela PII con auditoría). */
  value: string | null;
  isPrimary: boolean;
}

export interface LocationOption {
  id: string;
  locationType: string;
  address: string | null;
  zone?: string;
  latitude?: number;
  longitude?: number;
}

export interface AgendaClientContext {
  client: { id: string; displayName: string; nationalId: string | null };
  credits: CreditOption[];
  contacts: ContactOption[];
  locations: LocationOption[];
}

/**
 * Todo lo que el alta necesita del cliente elegido, en un round-trip: créditos agendables +
 * teléfonos y direcciones en claro. `error` si el cliente no tiene casos asignados a mí (AGENDA_002).
 */
export function clientContext(clientId: string): Promise<QueryResult<AgendaClientContext>> {
  return apiQuery<AgendaClientContext>(`/agenda/clients/${clientId}/context`);
}

/** Cuerpo de `POST /agenda`. El server deriva `clientId` y `assigneeId` — no van acá. */
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

/** Alta. Devuelve el ítem serializado → la pantalla lo inserta sin refetch. */
export function createItem(input: CreateAgendaInput): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>('/agenda', 'POST', input);
}

/** Canales que sirven para llamar o escribir. El endpoint rechaza `EMAIL`. */
export type PhoneContactType = 'PHONE' | 'WHATSAPP';

export interface NewClientContact {
  contactType: PhoneContactType;
  value: string;
  notes?: string;
}

/**
 * Carga un teléfono que el cliente no tenía, sin salir del formulario. Va por `agenda:write`
 * (el cobrador no tiene `client:write`). Devuelve el contacto listo para seleccionar.
 */
export function addClientContact(clientId: string, input: NewClientContact): Promise<MutateResult<ContactOption>> {
  return apiMutate<ContactOption>(`/agenda/clients/${clientId}/contacts`, 'POST', input);
}

/** Los del enum `LocationType` de Prisma. */
export type ClientLocationType = 'HOME' | 'WORK' | 'GUARANTOR' | 'FAMILY' | 'OTHER';

export interface NewClientLocation {
  locationType: ClientLocationType;
  address: string;
  zone?: string;
  /** Opcionales: se puede cargar la dirección sin marcar el punto. */
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
}

/** Carga una dirección que el cliente no tenía. Devuelve la ubicación lista para seleccionar. */
export function addClientLocation(clientId: string, input: NewClientLocation): Promise<MutateResult<LocationOption>> {
  return apiMutate<LocationOption>(`/agenda/clients/${clientId}/locations`, 'POST', input);
}
