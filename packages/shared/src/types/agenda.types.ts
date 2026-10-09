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
  /** Código del crédito (el que se muestra como «#C-123»). Sólo en las lecturas de lista y detalle. */
  creditCode?: string;
  /** Situación del crédito: sale del episodio de mora abierto (`moraSituation`). */
  creditSituation?: 'CURRENT' | 'IN_ARREARS';
  daysPastDue?: number;
  /** Categoría de mora calculada con los rangos de la cuenta; ausente con el crédito al día. */
  category?: { code: string; name: string; color?: string };
  /** Saldo pendiente del crédito, en `currency`. */
  balance?: number;
  currency?: string;
  /** Quién atiende la gestión: sólo nombre y apellido, nunca el correo. */
  assigneeName?: string;
  /** Quién la creó (`users.id`). Con esto el cliente decide si le muestra editar y eliminar: solo el creador puede. */
  createdBy?: string;
  /** Quién la asignó: el nombre de quien la creó, solo cuando no es el responsable. Nunca el correo. */
  assignedByName?: string;
  /** Quien mira puede editarla y eliminarla (la creó él y sigue pendiente). La API es la que lo hace cumplir. */
  canEdit?: boolean;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

/** La carga de una persona del equipo: lo que tiene pendiente hoy y lo vencido. */
export interface AgendaLoadRow {
  assigneeId: string;
  name?: string;
  pending: number;
  overdue: number;
}

/**
 * «¿Qué tengo que hacer hoy?» (`GET /agenda/summary`): pendientes de hoy, vencidas y las próximas del día. Con
 * `agenda:assign`, además la carga por persona. `date` es el día civil del tenant, el mismo con que se cuenta todo.
 */
export interface AgendaTodaySummary {
  date: string;
  pending: number;
  overdue: number;
  /** Hasta 5 pendientes de hoy: las de hora fija por hora, luego las de franja. */
  items: AgendaListItem[];
  load?: AgendaLoadRow[];
}

/** A quién se le puede asignar una gestión (`GET /agenda/assignees`): nombre y rol, sin correo ni teléfono. */
export interface AgendaAssignee {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  roleName: string;
  branchId: string | null;
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
  /** Cómo terminó, si se ejecutó: el resultado que se registró (`AGENDA_OUTCOMES_BY_TYPE`). */
  outcome?: string;
  /** Cuándo (hora exacta o franja) y de qué iba: la línea de tiempo del detalle los muestra. */
  timeMode?: ScheduleTimeMode;
  scheduledTime?: string;
  timeSlot?: string;
  observations?: string;
  details?: Record<string, unknown>;
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
  /** Qué pasó al ejecutarla: resultado, nota, quién y cuándo. Solo en las ejecutadas. */
  execution?: { outcome?: string; notes?: string; byName?: string; at: string };
  /** La ruta y la parada que llevan esta visita: se registra desde la parada (con GPS y evidencia), no desde la agenda. */
  route?: { routeId: string; stopId: string };
  /** A qué gestión se movió, si ésta quedó reagendada. */
  rescheduledTo?: { id: string; scheduledDate: string };
  /** Ausente en recordatorios y promesas: no hay a quién llamar ni a dónde ir. */
  target?: AgendaTarget;
  /** `code` → etiqueta del catálogo (medio de pago, banco). Sólo en promesas de pago. */
  labels?: Record<string, string>;
  history: AgendaHistoryEntry[];
}

export interface CreateAgendaInput {
  /** Lo pone quien escribe (el móvil, sin red): reintentar con el mismo id **no duplica** el agendado ni su recordatorio. */
  id?: string;
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
