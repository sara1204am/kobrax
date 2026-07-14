import type { CaseActivity, CollectionCase } from '@prisma/client';
import { creditView } from '@kobrax/shared';

const TERMINAL = ['CLOSED', 'WRITTEN_OFF'];

/** Datos mínimos del deudor para pintar la tarjeta de caso (nombre; NO PII cifrada). */
type CaseClient = { firstName: string | null; lastName: string | null; businessName: string | null };
/**
 * Datos financieros del crédito para la tarjeta de cartera (spec §5.3: "Cuota Bs 300 · vence 15 jul").
 * `metadata`/`installments` son opcionales: solo vienen cuando el query los incluye.
 */
type CaseCredit = {
  outstandingBalance: unknown;
  currency: string;
  daysPastDue: number;
  metadata?: unknown;
  installments?: { dueDate: Date; amount: unknown; status: string }[];
};

/** Nombre visible del deudor: razón social si es empresa, si no nombre + apellido. */
function clientDisplayName(c: CaseClient): string | undefined {
  if (c.businessName) return c.businessName;
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return full || undefined;
}

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

type CaseWithActivities = CollectionCase & {
  activities?: CaseActivity[];
  client?: CaseClient | null;
  credit?: CaseCredit | null;
};

export function serializeCase(c: CaseWithActivities, now: Date = new Date()) {
  const isOverdue = !!c.slaDueAt && !TERMINAL.includes(c.status) && c.slaDueAt.getTime() < now.getTime();
  // Cuota y próxima fecha: derivadas del cronograma si existe, leídas del metadata si no.
  // Misma función que usa el móvil → la tarjeta dice lo mismo en los dos lados.
  const view = c.credit
    ? creditView({
        metadata: c.credit.metadata,
        installments: c.credit.installments?.map((i) => ({ ...i, amount: Number(i.amount) })),
      })
    : undefined;
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
    // Enriquecido cuando el query incluye client/credit (listado de agenda); ausente en mutaciones.
    clientName: c.client ? clientDisplayName(c.client) : undefined,
    amount: c.credit ? Number(c.credit.outstandingBalance) : undefined,
    currency: c.credit?.currency,
    daysPastDue: c.credit?.daysPastDue, // mora calculada por el server (no por el reloj del móvil)
    installmentAmount: view?.installmentAmount,
    nextDueDate: view?.nextDueDate,
    frequency: view?.frequency,
    origin: view?.origin, // el móvil pinta el candado con esto (§4.3)
    locked: view?.locked,
    lastActionAt: c.lastActionAt ?? undefined,
    closedAt: c.closedAt ?? undefined,
    closedReason: c.closedReason ?? undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    activities: c.activities?.map(serializeActivity),
  };
}
