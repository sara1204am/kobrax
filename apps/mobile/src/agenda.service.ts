/**
 * Gestiones agendadas (lectura S1 + alta S2). Thin sobre `apiQuery`/`apiMutate`. Tipos verificados
 * contra `agenda.serializer.ts` del API (fechas llegan como ISO string vía JSON).
 */
import type {
  AgendaDetails,
  AgendaItemStatus,
  AgendaItemType,
  AgendaOutcome,
  AgendaPostponeStep,
  ScheduleTimeMode,
} from '@kobrax/shared';
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
  /** Motivo del desenlace no ejecutado: cancelación si está CANCELLED, reprogramación si RESCHEDULED. */
  reasonCode?: string;
  /** El agendado del que nació al reagendar (S6) — con esto se arma la cadena en el historial. */
  rescheduledFromId?: string;
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
  /** Motivo de la cancelación o de la reprogramación (S6). */
  reasonCode?: string;
  /** Si nació al reagendar otra, cuál — con esto se pinta la cadena. */
  rescheduledFromId?: string;
}

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

/** Detalle de una gestión (S3). Un round-trip: gestión + deudor + saldo + contacto + historial. */
export function getItem(id: string): Promise<QueryResult<AgendaItemDetail>> {
  return apiQuery<AgendaItemDetail>(`/agenda/${id}`);
}

/** Registrar la ejecución (S4): outcome + nota → el ítem pasa a EXECUTED. Devuelve el ítem actualizado. */
export function completeItem(id: string, outcome: AgendaOutcome, notes?: string): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/complete`, 'POST', { outcome, notes });
}

/** Posponer en pasos fijos (S4). El ítem sigue pendiente, con la hora corrida. */
export function postponeItem(id: string, minutes: AgendaPostponeStep): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/postpone`, 'POST', { minutes });
}

/**
 * URLs nativas para los botones del detalle. Sin teléfono no hay `tel:`; sin coordenadas se navega
 * **por texto**, que es lo que hace Maps cuando la dirección no tiene punto.
 *
 * `platform` decide el esquema del mapa: `geo:` sólo existe en Android — en iOS `Linking.openURL`
 * lo rechaza y el botón Navegar nunca abriría nada. Se pasa por parámetro para que el helper siga
 * siendo puro y testeable en los dos sistemas.
 */
export function actionLinks(
  target?: AgendaTarget,
  platform: 'ios' | 'android' | string = 'android',
): { tel?: string; geo?: string } {
  if (!target) return {};
  const tel = target.phone ? `tel:${target.phone.replace(/[^\d+]/g, '')}` : undefined;
  const ios = platform === 'ios';
  const geo =
    target.latitude != null && target.longitude != null
      ? ios
        ? `maps:0,0?ll=${target.latitude},${target.longitude}`
        : `geo:${target.latitude},${target.longitude}?q=${target.latitude},${target.longitude}`
      : target.address
        ? `${ios ? 'maps:0,0' : 'geo:0,0'}?q=${encodeURIComponent(target.address)}`
        : undefined;
  return { ...(tel && { tel }), ...(geo && { geo }) };
}

/**
 * Un agendado de WhatsApp abre WhatsApp con el mensaje ya escrito — no una llamada de voz.
 * `wa.me` es el enlace universal: si la app no está, cae al navegador.
 */
export function whatsappLink(phone: string, message?: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
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

/**
 * Cuerpo de `PATCH /agenda/:id` (S5). **Sin `scheduledDate` ni deudor**: mover el día es reagendar
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

/** Edita una gestión pendiente (S5). Devuelve el ítem actualizado. */
export function updateItem(id: string, input: UpdateAgendaInput): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}`, 'PATCH', input);
}

/** Cancela con motivo del catálogo `CANCEL_REASON` (S6). Sigue visible, con estado Cancelada. */
export function cancelItem(id: string, reasonCode: string): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/cancel`, 'POST', { reasonCode });
}

/** Cuerpo de `POST /agenda/:id/reschedule`. El motivo sale del catálogo `RESCHEDULE_REASON`. */
export interface RescheduleAgendaInput {
  scheduledDate: string;
  timeMode: ScheduleTimeMode;
  scheduledTime?: string;
  timeSlot?: string;
  reasonCode: string;
}

/** Reagenda a otro día (S6): cierra ésta como Reagendada y **devuelve la nueva**. */
export function rescheduleItem(id: string, input: RescheduleAgendaInput): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}/reschedule`, 'POST', input);
}

/** Elimina (soft-delete) una gestión cargada por error (S6). Responde 200 con el ítem, no 204. */
export function deleteItem(id: string): Promise<MutateResult<AgendaListItem>> {
  return apiMutate<AgendaListItem>(`/agenda/${id}`, 'DELETE');
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

/**
 * Corrige una dirección ya cargada — sobre todo, marcarle el punto a una importada, que llega sin
 * coordenadas. Se edita la que existe en vez de crear una segunda: el mapa dibuja la ubicación
 * primaria, así que una copia nueva no serviría de nada.
 */
export function updateClientLocation(
  clientId: string,
  locationId: string,
  input: Partial<NewClientLocation>,
): Promise<MutateResult<LocationOption>> {
  return apiMutate<LocationOption>(`/agenda/clients/${clientId}/locations/${locationId}`, 'PATCH', input);
}
