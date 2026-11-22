import { Prisma, type PrismaClient } from '@prisma/client';
import { isExternalOrigin, readCreditMetadata } from '@kobrax/shared';
import { loadCreditPlan } from '../credits/credit-plan';
import { accountToday } from '../../common/context/tenant-clock.service';

/**
 * Verificador de la imputación de pagos (auditoría «Mora vs Cartera»): comprueba que lo guardado cuadra y **reporta, nunca corrige**.
 * Una sola implementación para el trabajo nocturno y para las pruebas de integración, así lo que se prueba es lo que corre.
 *
 * Invariantes:
 *  · `APPLIED_EXCEEDS_PAYMENT`: Σ aplicaciones de un pago ≤ su monto (y nunca negativa).
 *  · `INSTALLMENT_PAID_BELOW_APPLICATIONS`: en un cronograma guardado, `paid_amount` no puede ser menor que lo aplicado a esa cuota.
 *  · `INSTALLMENT_PAID_ABOVE_AMOUNT`: ninguna cuota guardada puede tener pagado más que su importe.
 *  · `BALANCE_MISMATCH`: el saldo del crédito es el pendiente de su plan (con condiciones, sin saldo declarado a mano). Un crédito con
 *    pagos anteriores a `payment_applications` puede aparecer acá hasta que se regularice: es un aviso, no un error de la regla.
 */
export type IntegrityKind = 'APPLIED_EXCEEDS_PAYMENT' | 'INSTALLMENT_PAID_BELOW_APPLICATIONS' | 'INSTALLMENT_PAID_ABOVE_AMOUNT' | 'BALANCE_MISMATCH';

export interface IntegrityViolation {
  kind: IntegrityKind;
  creditId: string;
  paymentId?: string;
  installmentNumber?: number;
  expected: number;
  actual: number;
}

const EPS = 0.005;
/** Cuántos créditos con pagos se revisan contra su plan por corrida y por empresa (el resto, en las siguientes). */
export const INTEGRITY_BALANCE_BATCH = 500;

export async function findPaymentIntegrityViolations(
  tx: Pick<PrismaClient, '$queryRaw' | 'account' | 'credit' | 'payment' | 'paymentApplication'>,
  accountId: string,
  opts: { creditId?: string; balanceBatch?: number } = {},
): Promise<IntegrityViolation[]> {
  const out: IntegrityViolation[] = [];
  const onCredit = (col: string): Prisma.Sql => (opts.creditId ? Prisma.sql`AND ${Prisma.raw(col)} = ${opts.creditId}` : Prisma.empty);

  const exceeding = await tx.$queryRaw<{ payment_id: string; credit_id: string; amount: number; applied: number }[]>(Prisma.sql`
    SELECT p.id AS payment_id, p.credit_id, p.amount::float8 AS amount, COALESCE(SUM(a.amount), 0)::float8 AS applied
    FROM payments p LEFT JOIN payment_applications a ON a.payment_id = p.id
    WHERE p.account_id = ${accountId} ${onCredit('p.credit_id')}
    GROUP BY p.id
    HAVING COALESCE(SUM(a.amount), 0) > p.amount + ${EPS} OR COALESCE(SUM(a.amount), 0) < 0`);
  for (const r of exceeding) out.push({ kind: 'APPLIED_EXCEEDS_PAYMENT', creditId: r.credit_id, paymentId: r.payment_id, expected: r.amount, actual: r.applied });

  const stored = await tx.$queryRaw<{ credit_id: string; number: number; paid: number; amount: number; applied: number }[]>(Prisma.sql`
    SELECT i.credit_id, i.number, i.paid_amount::float8 AS paid, i.amount::float8 AS amount, COALESCE(SUM(a.amount), 0)::float8 AS applied
    FROM credit_installments i
    LEFT JOIN payment_applications a ON a.credit_id = i.credit_id AND a.installment_number = i.number
    WHERE i.account_id = ${accountId} ${onCredit('i.credit_id')}
    GROUP BY i.id
    HAVING i.paid_amount + ${EPS} < COALESCE(SUM(a.amount), 0) OR i.paid_amount > i.amount + ${EPS}`);
  for (const r of stored) {
    if (r.paid > r.amount + EPS) out.push({ kind: 'INSTALLMENT_PAID_ABOVE_AMOUNT', creditId: r.credit_id, installmentNumber: r.number, expected: r.amount, actual: r.paid });
    else out.push({ kind: 'INSTALLMENT_PAID_BELOW_APPLICATIONS', creditId: r.credit_id, installmentNumber: r.number, expected: r.applied, actual: r.paid });
  }

  // El saldo contra el plan: sólo créditos propios con condiciones y con pagos, y sin saldo declarado a mano al registrarlos.
  const credits = await tx.credit.findMany({
    where: { accountId, deletedAt: null, payments: { some: {} }, ...(opts.creditId ? { id: opts.creditId } : {}) },
    include: { installments: true },
    take: opts.balanceBatch ?? INTEGRITY_BALANCE_BATCH,
    orderBy: { updatedAt: 'desc' },
  });
  for (const credit of credits) {
    const meta = readCreditMetadata(credit.metadata, credit.origin);
    if (isExternalOrigin(meta.origin) || meta.initialState?.outstandingBalance !== undefined) continue;
    const plan = await loadCreditPlan(tx, accountId, credit, await accountToday(tx, accountId));
    if (!plan) continue;
    const balance = Number(credit.outstandingBalance);
    if (Math.abs(plan.balance - balance) > EPS) out.push({ kind: 'BALANCE_MISMATCH', creditId: credit.id, expected: plan.balance, actual: balance });
  }
  return out;
}
