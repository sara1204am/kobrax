import { InstallmentStatus, type Prisma } from '@prisma/client';
import {
  addPeriods,
  arrearsFromDueDate,
  isExternalOrigin,
  readCreditMetadata,
  type CreditMetadata,
} from '@kobrax/shared';

/** Aplicación pura de un pago al cronograma (cuota más antigua primero). Testeable. */
export interface InstallmentLite {
  id: string;
  number: number;
  amount: number;
  paidAmount: number;
  status: string;
  dueDate: Date;
}

export interface InstallmentUpdate {
  id: string;
  paidAmount: number;
  status: InstallmentStatus;
  paidAt: Date | null;
}

export interface ApplyResult {
  updates: InstallmentUpdate[];
  applied: number;
  leftover: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Distribuye `amount` sobre las cuotas no pagadas, de la más antigua a la más reciente. */
export function applyPayment(installments: InstallmentLite[], amount: number): ApplyResult {
  const ordered = installments.filter((i) => i.status !== 'PAID').sort((a, b) => a.number - b.number);
  let remaining = round2(amount);
  const updates: InstallmentUpdate[] = [];
  const now = new Date();

  for (const inst of ordered) {
    if (remaining <= 0) break;
    const due = round2(inst.amount - inst.paidAmount);
    if (due <= 0) continue;
    const pay = Math.min(remaining, due);
    const newPaid = round2(inst.paidAmount + pay);
    const fullyPaid = newPaid >= round2(inst.amount) - 0.005;
    updates.push({
      id: inst.id,
      paidAmount: newPaid,
      status: fullyPaid ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL,
      paidAt: fullyPaid ? now : null,
    });
    remaining = round2(remaining - pay);
  }
  return { updates, applied: round2(amount - remaining), leftover: remaining };
}

/** Días de mora = días desde la cuota vencida más antigua aún no pagada (0 si está al día). */
export function daysPastDue(installments: InstallmentLite[], asOf: Date): number {
  const overdue = installments.filter((i) => i.status !== 'PAID' && i.dueDate.getTime() < asOf.getTime());
  if (overdue.length === 0) return 0;
  const oldest = overdue.reduce((min, i) => (i.dueDate < min ? i.dueDate : min), overdue[0]!.dueDate);
  return Math.max(0, Math.floor((asOf.getTime() - oldest.getTime()) / 86_400_000));
}

/**
 * Lo que queda por actualizar del crédito tras un pago, más allá del saldo: la próxima fecha y la mora.
 * Puro y testeable. El orden importa — la mora se mide contra la fecha YA avanzada, si no, un pago que
 * cubre la cuota dejaría al crédito en mora contra la fecha que acaba de saldar.
 */
export interface CreditPatchAfterPayment {
  daysPastDue?: number;
  metadata?: Prisma.InputJsonObject;
}

export function creditPatchAfterPayment(p: {
  metadata: unknown;
  /** Cronograma con el estado YA aplicado del pago. Vacío ⇒ crédito sin cronograma (el del móvil). */
  installments: InstallmentLite[];
  amount: number;
  newBalance: number;
  creditPaid: boolean;
  now: Date;
}): CreditPatchAfterPayment {
  const meta = readCreditMetadata(p.metadata);
  const hasSchedule = p.installments.length > 0;
  const patch: CreditPatchAfterPayment = {};

  // 1) La próxima fecha avanza un período SOLO si la cuota quedó cubierta (spec §5.4). En un pago
  //    parcial "la cuota permanece vigente por el remanente" y la fecha no se mueve.
  //    ponytail: avanza un solo período aunque el pago cubra varias cuotas — es lo que dice la spec.
  //    Si en campo aparece el pago adelantado de 3 cuotas, acá se cambia a dividir por la cuota.
  let nextDueDate = meta.nextDueDate;
  const coversInstallment = !!meta.installmentAmount && p.amount >= meta.installmentAmount - 0.005;
  if (!hasSchedule && !p.creditPaid && nextDueDate && coversInstallment) {
    nextDueDate = toIsoDate(addPeriods(new Date(nextDueDate), 1, meta.frequency));
    patch.metadata = stripUndefined({ ...meta, nextDueDate });
  }

  // 2) La mora. En cartera de un core ajeno manda la fuente: no se recalcula (spec §6).
  if (isExternalOrigin(meta.origin)) return patch;
  if (p.creditPaid) {
    patch.daysPastDue = 0;
    return patch;
  }
  patch.daysPastDue = hasSchedule
    ? daysPastDue(p.installments, p.now)
    : arrearsFromDueDate(nextDueDate, p.newBalance, p.now);
  return patch;
}

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Prisma rechaza `undefined` dentro de un JSON: se van las claves vacías. */
function stripUndefined(meta: CreditMetadata): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Prisma.InputJsonObject;
}
