import { Prisma, type PrismaClient } from '@prisma/client';
import { isExternalOrigin, lateStateAt, readCreditMetadata } from '@kobrax/shared';
import { loadCreditPlan } from '../credits/credit-plan';
import { accountTimezone, accountToday, civilDayOf } from '../../common/context/tenant-clock.service';
import { LATE_POLICY_INCLUDE, lateParamsOf, loadLateContext } from './late-context';
import { planSourceOf } from './payment-apply';

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
 *  · `LATE_INTEREST_EXCEEDS_ACCRUED` (F17): lo cobrado + exonerado de mora de una cuota no puede superar lo que su devengo reproducido da hoy.
 *  · `PAID_WITH_LATE_PENDING` (F17 · D6): un crédito `PAID` no puede tener mora pendiente.
 */
export type IntegrityKind = 'APPLIED_EXCEEDS_PAYMENT' | 'INSTALLMENT_PAID_BELOW_APPLICATIONS' | 'INSTALLMENT_PAID_ABOVE_AMOUNT' | 'BALANCE_MISMATCH' | 'LATE_INTEREST_EXCEEDS_ACCRUED' | 'PAID_WITH_LATE_PENDING';

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
  tx: Pick<PrismaClient, '$queryRaw' | 'account' | 'credit' | 'payment' | 'paymentApplication' | 'creditLateWaiver'>,
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
    LEFT JOIN payment_applications a ON a.credit_id = i.credit_id AND a.installment_number = i.number AND a.component = 'SCHEDULED'
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
    include: { installments: true, latePolicyVersion: true },
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

  // Interés moratorio (F17): sólo créditos con política sellada y plan. La mora se REPRODUCE de los hechos y se compara con lo cobrado.
  const withPolicy = await tx.credit.findMany({
    where: {
      accountId,
      deletedAt: null,
      OR: [{ latePolicyVersion: { is: { kind: 'ANNUAL_RATE' } } }, { lateActivation: { isNot: null } }],
      payments: { some: {} },
      ...(opts.creditId ? { id: opts.creditId } : {}),
    },
    include: { installments: true, ...LATE_POLICY_INCLUDE },
    take: opts.balanceBatch ?? INTEGRITY_BALANCE_BATCH,
    orderBy: { updatedAt: 'desc' },
  });
  if (withPolicy.length > 0) {
    const tz = await accountTimezone(tx, accountId);
    const today = (await accountToday(tx, accountId)).toISOString().slice(0, 10);
    for (const credit of withPolicy) {
      const policy = lateParamsOf(credit.latePolicyVersion, credit.lateActivation);
      const source = planSourceOf(credit);
      if (!policy || !source) continue;
      const ctx = await loadLateContext(tx, {
        accountId,
        creditId: credit.id,
        tz,
        rows: source.rows,
        policy,
        stopAt: credit.writtenOffAt ? civilDayOf(credit.writtenOffAt, tz) : null,
        prepaidInstallments: source.prepaidInstallments,
        storedPaid: source.stored ? Object.fromEntries(credit.installments.map((i) => [i.number, Number(i.paidAmount)])) : undefined,
      });
      let pendingTotal = 0;
      for (const s of lateStateAt(ctx, today)) {
        const settled = Math.round(((ctx.lateCollected[s.installmentNumber] ?? 0) + (ctx.lateWaived[s.installmentNumber] ?? 0)) * 100);
        if (settled > Math.round(s.accrued * 100)) {
          out.push({ kind: 'LATE_INTEREST_EXCEEDS_ACCRUED', creditId: credit.id, installmentNumber: s.installmentNumber, expected: s.accrued, actual: settled / 100 });
        }
        pendingTotal += Math.round(s.pending * 100);
      }
      if (credit.status === 'PAID' && pendingTotal > 0) out.push({ kind: 'PAID_WITH_LATE_PENDING', creditId: credit.id, expected: 0, actual: pendingTotal / 100 });
    }
  }
  return out;
}
