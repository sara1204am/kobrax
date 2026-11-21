import type { CreditInstallment, PrismaClient } from '@prisma/client';
import { buildUpdatedPlan, isExternalOrigin, readCreditMetadata, type PlanAllocation, type UpdatedPlan } from '@kobrax/shared';
import { planSourceOf } from '../payments/payment-apply';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * El plan ACTUALIZADO de un crédito, leído de lo PERSISTIDO: el plan original (cronograma guardado o condiciones) con encima las
 * aplicaciones de cada pago (`payment_applications`). Es la ÚNICA fuente del estado financiero que ven Cartera, Mora y el historial de
 * pagos: ninguna pantalla recalcula nada por su cuenta.
 *
 *  · Operación de una fuente externa (PSF) → `null`: el saldo y la mora los informa el reporte, no hay plan que imputar.
 *  · Sin plan (préstamo abierto o sin condiciones) → `null`.
 *  · Cronograma guardado: lo que su `paid_amount` cubre más allá de las aplicaciones (pagado antes de que existiera la tabla) cuenta
 *    como cobertura previa, no como pago de Kobrax.
 */
export async function loadCreditPlan(
  tx: Pick<PrismaClient, 'paymentApplication' | 'payment'>,
  accountId: string,
  credit: { id: string; metadata: unknown; origin?: string | null; installments: CreditInstallment[] },
  asOf: Date = new Date(),
): Promise<UpdatedPlan | null> {
  if (isExternalOrigin(readCreditMetadata(credit.metadata, credit.origin).origin)) return null;
  const source = planSourceOf(credit);
  if (!source) return null;

  const [applications, payments] = await Promise.all([
    tx.paymentApplication.findMany({ where: { accountId, creditId: credit.id }, select: { paymentId: true, installmentNumber: true, amount: true } }),
    tx.payment.findMany({ where: { accountId, creditId: credit.id }, select: { id: true, amount: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const allocations: PlanAllocation[] = applications.map((a) => ({ paymentId: a.paymentId, installmentNumber: a.installmentNumber, amount: Number(a.amount) }));

  const priorPaid: Record<number, number> = {};
  if (source.stored) {
    const applied = new Map<number, number>();
    for (const a of allocations) applied.set(a.installmentNumber, round2((applied.get(a.installmentNumber) ?? 0) + a.amount));
    for (const i of credit.installments) priorPaid[i.number] = Math.max(0, round2(Number(i.paidAmount) - (applied.get(i.number) ?? 0)));
  }

  return buildUpdatedPlan({
    rows: source.rows,
    prepaidInstallments: source.prepaidInstallments,
    priorPaid,
    payments: payments.map((p) => ({ id: p.id, amount: Number(p.amount), registeredAt: p.createdAt })),
    allocations,
    asOf,
  });
}
