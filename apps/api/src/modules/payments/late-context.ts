import type { PrismaClient } from '@prisma/client';
import { principalEventsByInstallment, type LateAllocationInput, type LateInterestParams, type PlanScheduleRow } from '@kobrax/shared';
import { civilDayOf } from '../../common/context/tenant-clock.service';

const round2 = (x: number): number => Math.round(x * 100) / 100;

type PolicyVersionShape = { kind: string; annualRate: unknown; dayCount: number | null; graceDays: number; capPctOfPrincipal: unknown };
type ActivationShape = { startsOn: Date; policyVersion: PolicyVersionShape };

/** Lo que hay que cargar con el crédito para conocer su política EFECTIVA: la sellada al nacer y, si existe, su activación (F3-e). */
export const LATE_POLICY_INCLUDE = { latePolicyVersion: true, lateActivation: { include: { policyVersion: true } } } as const;

/** El día civil (`YYYY-MM-DD`) de una columna `DATE`. */
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * La política EFECTIVA del crédito, tal como la necesita el cálculo. `null` = sin cargos (camino de siempre).
 * Si el crédito tiene una activación explícita (F3-e), manda su política sellada y su fecha de inicio; si no, la sellada al nacer.
 */
export function lateParamsOf(v: PolicyVersionShape | null | undefined, activation?: ActivationShape | null): LateInterestParams | null {
  if (activation) {
    const base = lateParamsOf(activation.policyVersion);
    return base ? { ...base, startsOn: dateOnly(activation.startsOn) } : null;
  }
  if (!v || v.kind !== 'ANNUAL_RATE' || v.annualRate === null || v.annualRate === undefined) return null;
  const rate = Number(v.annualRate);
  if (!(rate > 0)) return null;
  return {
    annualRate: rate,
    dayCount: v.dayCount === 360 ? 360 : 365,
    graceDays: v.graceDays,
    capPctOfPrincipal: v.capPctOfPrincipal === null || v.capPctOfPrincipal === undefined ? null : Number(v.capPctOfPrincipal),
  };
}

/**
 * Lo que hace falta de la historia del crédito para calcular la mora al imputar un pago: lo programado ya cubierto por cuota, los pagos que
 * tocaron el capital (con su fecha de cobro civil), y lo cobrado / exonerado de mora. Todo sale de HECHOS (aplicaciones, exoneraciones).
 *
 * 🔴 La fecha de cobro de un pago es el día civil de `payments.payment_date` en la zona de la cuenta: la misma regla al registrar que al
 * reproducir, así el verificador cuenta la misma historia.
 */
export async function loadLateContext(
  tx: Pick<PrismaClient, 'paymentApplication' | 'creditLateWaiver'>,
  p: {
    accountId: string;
    creditId: string;
    tz: string;
    rows: readonly PlanScheduleRow[];
    policy: LateInterestParams;
    stopAt: string | null;
    /** Cuotas pagadas antes de registrar el crédito (cronograma de condiciones). */
    prepaidInstallments: number;
    /** Cronograma guardado: su `paid_amount` por cuota (lo que excede las aplicaciones es cobertura previa, no un pago fechado). */
    storedPaid?: Readonly<Record<number, number>>;
  },
): Promise<LateAllocationInput> {
  const [apps, waivers] = await Promise.all([
    tx.paymentApplication.findMany({
      where: { accountId: p.accountId, creditId: p.creditId },
      select: { installmentNumber: true, amount: true, component: true, createdAt: true, payment: { select: { paymentDate: true, createdAt: true } } },
    }),
    tx.creditLateWaiver.findMany({ where: { accountId: p.accountId, creditId: p.creditId }, select: { installmentNumber: true, amount: true } }),
  ]);
  // Orden de REGISTRO: el del pago, y dentro de un pago, el de la aplicación.
  const ordered = [...apps].sort((a, b) => a.payment.createdAt.getTime() - b.payment.createdAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime());

  const scheduled = ordered.filter((a) => a.component === 'SCHEDULED');
  const applied: Record<number, number> = {};
  for (const a of scheduled) applied[a.installmentNumber] = round2((applied[a.installmentNumber] ?? 0) + Number(a.amount));
  const sortedRows = [...p.rows].sort((a, b) => a.number - b.number);
  const prior: Record<number, number> = {};
  sortedRows.forEach((r, i) => {
    prior[r.number] = p.storedPaid ? Math.max(0, round2((p.storedPaid[r.number] ?? 0) - (applied[r.number] ?? 0))) : i < p.prepaidInstallments ? r.amount : 0;
  });
  const scheduledPaid: Record<number, number> = {};
  for (const r of sortedRows) scheduledPaid[r.number] = round2(prior[r.number]! + (applied[r.number] ?? 0));

  const lateCollected: Record<number, number> = {};
  for (const a of ordered) if (a.component === 'LATE_INTEREST') lateCollected[a.installmentNumber] = round2((lateCollected[a.installmentNumber] ?? 0) + Number(a.amount));
  const lateWaived: Record<number, number> = {};
  for (const w of waivers) lateWaived[w.installmentNumber] = round2((lateWaived[w.installmentNumber] ?? 0) + Number(w.amount));

  const principalEvents = principalEventsByInstallment({
    rows: p.rows,
    priorPaid: prior,
    applications: scheduled.map((a) => ({ installmentNumber: a.installmentNumber, amount: Number(a.amount), date: civilDayOf(a.payment.paymentDate, p.tz) })),
  });

  return { rows: p.rows, policy: p.policy, scheduledPaid, principalEvents, lateCollected, lateWaived, stopAt: p.stopAt };
}
