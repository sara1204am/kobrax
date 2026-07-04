import { InstallmentStatus } from '@prisma/client';

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
