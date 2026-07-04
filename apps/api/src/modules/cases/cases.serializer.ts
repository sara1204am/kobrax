import type { CaseActivity, CollectionCase } from '@prisma/client';

const TERMINAL = ['CLOSED', 'WRITTEN_OFF'];

export function serializeActivity(a: CaseActivity) {
  return {
    id: a.id,
    type: a.type,
    result: a.result ?? undefined,
    notes: a.notes ?? undefined,
    userId: a.userId ?? undefined,
    createdAt: a.createdAt,
  };
}

type CaseWithActivities = CollectionCase & { activities?: CaseActivity[] };

export function serializeCase(c: CaseWithActivities, now: Date = new Date()) {
  const isOverdue = !!c.slaDueAt && !TERMINAL.includes(c.status) && c.slaDueAt.getTime() < now.getTime();
  return {
    id: c.id,
    creditId: c.creditId,
    clientId: c.clientId,
    branchId: c.branchId ?? undefined,
    assigneeId: c.assigneeId ?? undefined,
    status: c.status,
    priority: c.priority,
    slaDueAt: c.slaDueAt ?? undefined,
    isOverdue, // derivado (el catálogo "overdue" del doc se modela vía SLA)
    lastActionAt: c.lastActionAt ?? undefined,
    closedAt: c.closedAt ?? undefined,
    closedReason: c.closedReason ?? undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    activities: c.activities?.map(serializeActivity),
  };
}
