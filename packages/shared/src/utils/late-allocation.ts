/**
 * Imputación de UN pago con interés moratorio (F17 · F3-c). Pura, en centavos enteros, sin Nest ni Prisma.
 *
 * Orden (D1): por cuota, de la más antigua: **mora → interés corriente → capital**; lo que sobra pasa a la cuota siguiente.
 * La mora de cada cuota se calcula a la FECHA DE COBRO del pago (D4) con `accrueLateInterest`, a partir de los pagos anteriores
 * que tocaron su capital (cada uno cerró un tramo). Lo ya cobrado de mora y lo exonerado se descuentan: la mora pendiente se DERIVA, no se guarda.
 *
 * Lo programado de una cuota (capital + interés corriente) se cubre interés primero: la parte de CAPITAL de un pago es lo que sobra
 * después del interés corriente, igual que en `buildUpdatedPlan`. Sólo esa parte reduce la base del devengo.
 *
 * Una cuota SIN partición capital/interés no devenga (no hay base): se informa, no se inventa.
 */
import { accrueLateInterest, type LateInterestParams, type LatePrincipalEvent } from './late-interest';
import type { PlanScheduleRow } from './payment-plan';

const toCents = (units: number): number => Math.round(units * 100);
const fromCents = (cents: number): number => cents / 100;

/** Un pago ya aplicado a lo PROGRAMADO de una cuota, para reconstruir cuándo se tocó su capital. Va en orden de REGISTRO. */
export interface ScheduledApplication {
  installmentNumber: number;
  amount: number;
  /** Fecha de cobro civil del pago (`YYYY-MM-DD`). */
  date: string;
}

/**
 * Los pagos que tocaron el CAPITAL de cada cuota, a partir de las aplicaciones programadas (en orden de registro).
 * `priorPaid` = lo cubierto sin ser un pago fechado (prepago al registrar): cuenta como capital pagado desde el vencimiento.
 */
export function principalEventsByInstallment(input: {
  rows: readonly PlanScheduleRow[];
  priorPaid?: Readonly<Record<number, number>>;
  applications: readonly ScheduledApplication[];
}): Record<number, LatePrincipalEvent[]> {
  const out: Record<number, LatePrincipalEvent[]> = {};
  const paid = new Map<number, number>();
  const byNumber = new Map(input.rows.map((r) => [r.number, r]));
  for (const r of input.rows) {
    const prior = toCents(input.priorPaid?.[r.number] ?? 0);
    paid.set(r.number, prior);
    const interest = toCents(r.interest ?? 0);
    const principalPrior = Math.max(0, prior - interest);
    if (principalPrior > 0) out[r.number] = [{ date: r.dueDate, principal: fromCents(principalPrior) }];
  }
  for (const a of input.applications) {
    const row = byNumber.get(a.installmentNumber);
    const cents = toCents(a.amount);
    if (!row || cents <= 0) continue;
    const interest = toCents(row.interest ?? 0);
    const before = paid.get(a.installmentNumber) ?? 0;
    const after = before + cents;
    paid.set(a.installmentNumber, after);
    const principalPart = Math.max(0, after - interest) - Math.max(0, before - interest);
    if (principalPart > 0) (out[a.installmentNumber] ??= []).push({ date: a.date, principal: fromCents(principalPart) });
  }
  return out;
}

export interface LateAllocationInput {
  rows: readonly PlanScheduleRow[];
  policy: LateInterestParams;
  /** Lo programado ya cubierto por cuota (prepago + aplicaciones anteriores). */
  scheduledPaid: Readonly<Record<number, number>>;
  /** Pagos anteriores que tocaron el capital de cada cuota (ver `principalEventsByInstallment`). */
  principalEvents: Readonly<Record<number, readonly LatePrincipalEvent[]>>;
  /** Mora ya cobrada y exonerada por cuota. */
  lateCollected: Readonly<Record<number, number>>;
  lateWaived: Readonly<Record<number, number>>;
  /** Día en que se cortó el devengo del crédito castigado (D7). */
  stopAt?: string | null;
}

export interface LateInstallmentState {
  installmentNumber: number;
  /** Devengado hasta el corte, ya con tope. */
  accrued: number;
  /** Devengado − cobrado − exonerado (mínimo 0). */
  pending: number;
  scheduledPending: number;
}

/** La mora pendiente de cada cuota con algo que cobrar, al día `asOf`. */
export function lateStateAt(input: LateAllocationInput, asOf: string): LateInstallmentState[] {
  const out: LateInstallmentState[] = [];
  for (const r of [...input.rows].sort((a, b) => a.number - b.number)) {
    const scheduledPending = Math.max(0, toCents(r.amount) - toCents(input.scheduledPaid[r.number] ?? 0));
    const split = r.principal !== undefined && r.interest !== undefined;
    let accrued = 0;
    if (split) {
      accrued = accrueLateInterest({
        dueDate: r.dueDate,
        principal: r.principal!,
        events: input.principalEvents[r.number] ?? [],
        policy: input.policy,
        asOf,
        stopAt: input.stopAt ?? null,
      }).accruedCents;
    }
    const pending = Math.max(0, accrued - toCents(input.lateCollected[r.number] ?? 0) - toCents(input.lateWaived[r.number] ?? 0));
    out.push({ installmentNumber: r.number, accrued: fromCents(accrued), pending: fromCents(pending), scheduledPending: fromCents(scheduledPending) });
  }
  return out;
}

export interface LateAllocation {
  allocations: { installmentNumber: number; component: 'SCHEDULED' | 'LATE_INTEREST'; amount: number }[];
  /** Lo que no cupo (mora pendiente + saldo programado ya cubiertos). */
  unapplied: number;
  /** Cuánto de lo aplicado fue a mora y cuánto a lo programado. */
  lateApplied: number;
  scheduledApplied: number;
  /** Lo máximo que un pago a ese día puede cubrir: saldo programado + mora pendiente. */
  payable: number;
  /** Mora que queda pendiente DESPUÉS de este pago (al mismo día de corte). */
  latePendingAfter: number;
}

/** Reparte `amount` (con fecha de cobro `date`) mora → programado por cuota, de la más antigua. */
export function allocateWithLateInterest(input: LateAllocationInput & { amount: number; date: string }): LateAllocation {
  const states = lateStateAt(input, input.date);
  const payable = states.reduce((s, x) => s + toCents(x.pending) + toCents(x.scheduledPending), 0);
  let remaining = Math.max(0, toCents(input.amount));
  const allocations: LateAllocation['allocations'] = [];
  let lateApplied = 0;
  let scheduledApplied = 0;
  let latePendingAfter = 0;

  for (const s of states) {
    const latePay = Math.min(remaining, toCents(s.pending));
    remaining -= latePay;
    const schedPay = Math.min(remaining, toCents(s.scheduledPending));
    remaining -= schedPay;
    if (latePay > 0) allocations.push({ installmentNumber: s.installmentNumber, component: 'LATE_INTEREST', amount: fromCents(latePay) });
    if (schedPay > 0) allocations.push({ installmentNumber: s.installmentNumber, component: 'SCHEDULED', amount: fromCents(schedPay) });
    lateApplied += latePay;
    scheduledApplied += schedPay;
    latePendingAfter += toCents(s.pending) - latePay;
  }
  return {
    allocations,
    unapplied: fromCents(remaining),
    lateApplied: fromCents(lateApplied),
    scheduledApplied: fromCents(scheduledApplied),
    payable: fromCents(payable),
    latePendingAfter: fromCents(latePendingAfter),
  };
}
