import type { AgendaItem } from '@prisma/client';
import { AgendaItemStatus } from '@prisma/client';

/**
 * Lo que la lista del panel pinta además de la gestión: el crédito (código, situación, días, saldo) y quién la
 * atiende. Todo opcional: las respuestas de una sola gestión (alta, edición…) no lo traen.
 */
export interface AgendaRowExtra {
  creditCode?: string;
  creditSituation?: 'CURRENT' | 'IN_ARREARS';
  daysPastDue?: number;
  category?: { code: string; name: string; color?: string };
  balance?: number;
  currency?: string;
  assigneeName?: string;
  /**
   * Quién la asignó: el nombre de quien la creó, solo cuando no es el responsable (nadie «se asigna» a sí mismo).
   * Nunca el correo.
   */
  assignedByName?: string;
  /** Quien pide puede editarla y eliminarla: la creó él y sigue pendiente. El cliente solo dibuja el botón; la API lo hace cumplir. */
  canEdit?: boolean;
}

/**
 * Payload público de una gestión agendada. `clientName` se pasa aparte (clientId es ref suave,
 * el servicio resuelve el nombre). `isOverdue` = derivado: SCHEDULED && fecha < hoy.
 *
 * ⚠️ `today` es **la medianoche UTC del día civil del tenant**, no la hora actual: lo calcula
 * `TenantClockService` y el servicio lo pasa hecho. Derivarlo acá de un `new Date()` era el bug que
 * pintaba vencido el día entero a las 20:00 en Bolivia. El default es sólo para los tests.
 */
export function serializeAgendaItem(
  a: AgendaItem,
  clientName: string | undefined,
  today: Date = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
  extra: AgendaRowExtra = {},
) {
  return {
    ...extra,
    id: a.id,
    clientId: a.clientId,
    creditId: a.creditId,
    assigneeId: a.assigneeId,
    createdBy: a.createdBy ?? undefined,
    type: a.type,
    status: a.status,
    priorityCode: a.priorityCode ?? undefined,
    expectedResultCode: a.expectedResultCode ?? undefined,
    scheduledDate: a.scheduledDate,
    timeMode: a.timeMode,
    scheduledTime: a.scheduledTime ?? undefined,
    timeSlot: a.timeSlot ?? undefined,
    observations: a.observations ?? undefined,
    details: a.details,
    resultActivityId: a.resultActivityId ?? undefined,
    reasonCode: a.reasonCode ?? undefined,
    rescheduledFromId: a.rescheduledFromId ?? undefined,
    clientName,
    isOverdue: a.status === AgendaItemStatus.SCHEDULED && a.scheduledDate.getTime() < today.getTime(),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}
