import { CaseStatus, type CasePriority, type PrismaClient } from '@prisma/client';
import type { CaseCloseReason } from '@kobrax/shared';

/**
 * Abrir y cerrar el caso de cobranza de un crédito. **Las dos únicas formas que hay**, y las usan
 * los dos que las necesitan: el trabajo diario y el marcar/poner al día de la ficha.
 *
 * 🔴 Viven acá y no adentro del job porque marcar en mora **no espera al job**: quien aprieta ese
 * botón quiere ver el crédito en Mora ahora, no en la próxima pasada. Con la lógica encerrada en el
 * job, el endpoint la copiaba — y la copia es donde se olvida el `assigneeId` heredado, o el motivo
 * de cierre, o el `deletedAt` del `where`.
 */

/** Los estados en los que el caso todavía se trabaja. Mismo criterio que `cases` y que `routes`. */
export const OPEN_STATUSES: CaseStatus[] = [
  CaseStatus.PENDING,
  CaseStatus.ACTIVE,
  CaseStatus.IN_NEGOTIATION,
  CaseStatus.PROMISE_TO_PAY,
  CaseStatus.PAID,
];

const TERMINAL: CaseStatus[] = [CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF];

export interface OpenCaseInput {
  accountId: string;
  creditId: string;
  clientId: string;
  branchId?: string | null;
  /**
   * 🔴 **El responsable del préstamo.** Sin esto el caso nace sin dueño, y `routes.generate` filtra
   * por `assigneeId`: la cartera se llenaría de casos que no entran a la ruta de nadie. Nulo cuando
   * el crédito tampoco tiene responsable — ahí lo reparte quien supervisa, que es una decisión de
   * persona y no del sistema.
   */
  assigneeId?: string | null;
  priority: CasePriority;
  slaDueAt: Date;
}

/** Abre el caso si no hay uno abierto. Devuelve `true` si lo creó — idempotente por crédito. */
export async function openCaseIfNone(tx: PrismaClient, input: OpenCaseInput): Promise<boolean> {
  const abierto = await tx.collectionCase.findFirst({
    where: { creditId: input.creditId, deletedAt: null, status: { notIn: TERMINAL } },
    select: { id: true },
  });
  if (abierto) return false;

  await tx.collectionCase.create({
    data: {
      accountId: input.accountId,
      creditId: input.creditId,
      clientId: input.clientId,
      branchId: input.branchId,
      assigneeId: input.assigneeId,
      status: CaseStatus.PENDING,
      priority: input.priority,
      slaDueAt: input.slaDueAt,
    },
  });
  return true;
}

/**
 * Cierra los casos abiertos de un crédito. Devuelve cuántos cerró.
 *
 * 🔴 **Escribe `CLOSED` directo, sin pasar por `CASE_TRANSITIONS` ni exigir gestión registrada.**
 * La máquina de estados gobierna lo que una persona puede hacer desde la ficha —de `PENDING` sólo se
 * puede pasar a `ACTIVE`, y cerrar pide una gestión (`CASE_001`)— y eso está bien para una
 * negociación. Acá no hay negociación que cerrar: la deuda se pagó o dejó de estar vencida. Si
 * además cobró por transferencia, no hubo visita y nunca va a haber gestión que registrar.
 *
 * `closedBy` queda nulo a propósito: no lo cerró nadie, lo cerró el sistema. El motivo es lo que
 * después deja contar por qué desaparecieron cuarenta casos un martes.
 */
export async function closeOpenCases(
  tx: PrismaClient,
  creditId: string,
  reason: CaseCloseReason,
  asOf: Date,
): Promise<number> {
  const { count } = await tx.collectionCase.updateMany({
    where: { creditId, deletedAt: null, status: { notIn: TERMINAL } },
    data: { status: CaseStatus.CLOSED, closedAt: asOf, closedReason: reason, lastActionAt: asOf },
  });
  return count;
}

/**
 * Reabre el caso que el sistema cerró porque la operación externa dejó de venir en su reporte
 * (`SOURCE_ABSENT`). Devuelve `true` si reabrió uno.
 *
 * 🔴 **Reabre el mismo caso, no abre otro.** La ausencia no fue un cierre de verdad —nadie cobró ni
 * se puso al día, el reporte simplemente no la trajo—, así que las gestiones, promesas y el
 * responsable de antes siguen siendo de esta deuda. Un caso nuevo los dejaría colgados de uno
 * cerrado y el cobrador empezaría de cero con un deudor que ya conocía.
 *
 * Sólo toca el **último** caso del crédito y sólo si su motivo es `SOURCE_ABSENT`: uno cerrado a mano
 * o por pago no lo resucita la reaparición, igual que la ausencia no resucita créditos cerrados (D4).
 * Vuelve a `ACTIVE` —el estado anterior no se guardó al cerrar— y con la prioridad del dato nuevo,
 * salvo que estuviera fijada a mano.
 */
export async function reopenAbsentCase(
  tx: PrismaClient,
  creditId: string,
  priority: CasePriority,
  slaDueAt: Date,
  asOf: Date,
): Promise<boolean> {
  const last = await tx.collectionCase.findFirst({
    where: { creditId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, closedReason: true, priorityPinnedAt: true },
  });
  if (!last || last.status !== CaseStatus.CLOSED || last.closedReason !== 'SOURCE_ABSENT') return false;

  await tx.collectionCase.update({
    where: { id: last.id },
    data: {
      status: CaseStatus.ACTIVE,
      closedAt: null,
      closedReason: null,
      // La prioridad fijada a mano sobrevive a la ausencia: la decidió una persona, no el dato.
      ...(last.priorityPinnedAt ? {} : { priority }),
      slaDueAt,
      lastActionAt: asOf,
    },
  });
  return true;
}
