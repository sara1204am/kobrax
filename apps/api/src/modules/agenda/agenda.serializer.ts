import type { AgendaItem } from '@prisma/client';
import { AgendaItemStatus } from '@prisma/client';

/** Inicio del día (UTC) de `now`, para derivar el "vencido". */
function startOfDayUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Payload público de una gestión agendada. `clientName` se pasa aparte (clientId es ref suave,
 * el servicio resuelve el nombre). `isOverdue` = derivado: SCHEDULED && fecha < hoy.
 */
export function serializeAgendaItem(a: AgendaItem, clientName: string | undefined, now: Date = new Date()) {
  return {
    id: a.id,
    caseId: a.caseId,
    clientId: a.clientId,
    creditId: a.creditId,
    assigneeId: a.assigneeId,
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
    clientName,
    isOverdue: a.status === AgendaItemStatus.SCHEDULED && a.scheduledDate.getTime() < startOfDayUTC(now).getTime(),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}
