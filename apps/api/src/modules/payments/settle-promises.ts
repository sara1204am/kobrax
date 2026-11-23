import type { PrismaClient } from '@prisma/client';
import { recordCreditActivity } from '../mora/credit-activity';

/**
 * Cierra solas las **promesas de pago cumplidas**.
 *
 * 🔴 **Antes una promesa solo se cerraba a mano** (alguien ejecutaba la gestión con «cumplió» o «incumplió»): el deudor pagaba más de lo
 * prometido y la promesa seguía «Vigente» con 0 cumplidas. Ahora, al registrar un pago, cada promesa pendiente del crédito se compara con lo
 * pagado en su ventana, y si lo cubre queda **cumplida** (resultado `PROMISE_KEPT`, la misma gestión que dejaría quien la cerrara a mano).
 *
 * La ventana va **desde el día en que se hizo la promesa hasta el final del día prometido** (más unas horas de margen: en Bolivia, un pago de la
 * tarde ya es del día siguiente en UTC). Cuenta cualquier pago del crédito, sea cual sea su canal: que el deudor pagó es lo que cumple la promesa.
 *
 * Solo cierra como cumplida. Si lo pagado no alcanza, no la da por incumplida: eso sigue siendo de quien hace la cobranza (vence sin cerrar).
 */
const DAY_MS = 86_400_000;
/** Margen tras el día prometido: cubre el desfase de zona horaria (un pago de la tarde en Bolivia ya es del día siguiente en UTC). */
const GRACE_MS = 6 * 3_600_000;
/** Tolerancia de céntimos al comparar montos. */
const EPS = 0.005;

const startOfUtcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export async function settlePromisesFromPayments(
  tx: Pick<PrismaClient, 'agendaItem' | 'payment' | 'creditActivity' | 'creditArrearEpisode' | 'credit'>,
  p: { accountId: string; creditId: string; clientId: string; userId?: string },
): Promise<string[]> {
  const pending = await tx.agendaItem.findMany({
    where: { creditId: p.creditId, type: 'PROMISE_TO_PAY', status: 'SCHEDULED', deletedAt: null },
    select: { id: true, scheduledDate: true, details: true, createdAt: true },
  });
  const kept: string[] = [];

  for (const promise of pending) {
    const amount = Number((promise.details as { amount?: unknown } | null)?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const from = new Date(startOfUtcDay(promise.createdAt));
    const to = new Date(startOfUtcDay(promise.scheduledDate) + DAY_MS + GRACE_MS);
    const paid = await tx.payment.aggregate({
      where: { creditId: p.creditId, paymentDate: { gte: from, lt: to } },
      _sum: { amount: true },
    });
    if (Number(paid._sum.amount ?? 0) + EPS < amount) continue;

    const activity = await recordCreditActivity(tx, {
      accountId: p.accountId,
      creditId: p.creditId,
      clientId: p.clientId,
      userId: p.userId,
      type: 'NOTE',
      result: 'PROMISE_KEPT',
      notes: 'Promesa cumplida: los pagos registrados cubren el monto prometido.',
    });
    await tx.agendaItem.update({
      where: { id: promise.id },
      data: { status: 'EXECUTED', resultActivityId: activity.id, ...(p.userId ? { updatedBy: p.userId } : {}) },
    });
    // El recordatorio de «mañana vence tu promesa» ya no hace falta.
    await tx.agendaItem.updateMany({
      where: { type: 'REMINDER', status: 'SCHEDULED', deletedAt: null, details: { path: ['promiseItemId'], equals: promise.id } },
      data: { status: 'CANCELLED', ...(p.userId ? { updatedBy: p.userId } : {}) },
    });
    kept.push(promise.id);
  }
  return kept;
}
