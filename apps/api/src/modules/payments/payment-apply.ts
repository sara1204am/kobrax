import { InstallmentStatus, type Prisma } from '@prisma/client';
import {
  addPeriods,
  arrearsByMethod,
  calculateCredit,
  isExternalOrigin,
  oldestUnpaid,
  readCreditMetadata,
  type CreditMetadata,
  type PlanScheduleRow,
  type UpdatedPlan,
  withArrearsMethod,
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

  /*
   * D20: según el método del crédito. Con el de siempre, pagar la cuota más atrasada baja la mora;
   * con el bancario sigue contando desde el primer atraso hasta quedar al día. Saldado, todo a 0.
   */
  const reading = p.creditPaid
    ? { daysPastDue: 0, arrearsSince: undefined }
    : hasSchedule
      ? withArrearsMethod({
          baseDays: daysPastDue(p.installments, p.now),
          method: meta.arrearsMethod,
          oldestUnpaidDue: oldestUnpaid(p.installments)?.dueDate,
          arrearsSince: meta.arrearsSince,
          asOf: p.now,
        })
      : arrearsByMethod({
          method: meta.arrearsMethod,
          oldestUnpaidDue: nextDueDate,
          arrearsSince: meta.arrearsSince,
          balance: p.newBalance,
          asOf: p.now,
        });
  patch.daysPastDue = reading.daysPastDue;
  if (reading.arrearsSince !== meta.arrearsSince) {
    patch.metadata = stripUndefined({ ...meta, nextDueDate, arrearsSince: reading.arrearsSince });
  }
  return patch;
}

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Prisma rechaza `undefined` dentro de un JSON: se van las claves vacías. */
function stripUndefined(meta: CreditMetadata): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Prisma.InputJsonObject;
}

/**
 * De dónde sale el PLAN ORIGINAL de un crédito para imputar un pago (auditoría «Mora vs Cartera»):
 *  · cronograma guardado (`credit_installments`) → esas filas;
 *  · si no, las condiciones (`metadata.terms`) → el plan que regenera `calculateCredit`, con las cuotas ya pagadas al registrar;
 *  · si no hay ninguno (préstamo abierto, o uno sin condiciones) → `null`: no hay plan que imputar y manda la lógica de siempre.
 * Puro y testeable.
 */
export interface PlanSource {
  rows: PlanScheduleRow[];
  /** Cuotas pagadas ANTES de registrar el crédito en Kobrax (`initialState`). Sólo con condiciones. */
  prepaidInstallments: number;
  /** `true` si las filas son las guardadas en `credit_installments` (hay que mantener sus copias de lectura). */
  stored: boolean;
}

/**
 * Capital e interés de la cuota, sólo si cierran con su importe (una cuota con seguro o cargos dentro no se parte: lo demás no es capital).
 * Sin la partición, la cuota se muestra entera.
 */
function splitOf(amount: number, principal: unknown, interest: unknown): { principal?: number; interest?: number } {
  const p = principal === undefined || principal === null ? NaN : Number(principal);
  const i = interest === undefined || interest === null ? NaN : Number(interest);
  return Number.isFinite(p) && Number.isFinite(i) && Math.abs(p + i - amount) < 0.005 ? { principal: p, interest: i } : {};
}

export function planSourceOf(credit: {
  metadata: unknown;
  origin?: string | null;
  installments: { number: number; dueDate: Date; amount: unknown; principal?: unknown; interest?: unknown }[];
}): PlanSource | null {
  if (credit.installments.length > 0) {
    return {
      rows: credit.installments.map((i) => ({ number: i.number, dueDate: i.dueDate.toISOString().slice(0, 10), amount: Number(i.amount), ...splitOf(Number(i.amount), i.principal, i.interest) })),
      prepaidInstallments: 0,
      stored: true,
    };
  }
  const meta = readCreditMetadata(credit.metadata, credit.origin);
  if (!meta.terms) return null;
  const schedule = calculateCredit(meta.terms).schedule;
  if (!schedule || schedule.length === 0) return null;
  return {
    rows: schedule.map((r) => ({ number: r.number, dueDate: r.dueDate, amount: r.amount, ...splitOf(r.amount, r.principal, r.interest) })),
    prepaidInstallments: meta.initialState?.paidInstallments ?? 0,
    stored: false,
  };
}

/**
 * Lo que queda por actualizar del crédito tras un pago, leído del PLAN ACTUALIZADO (no del pago suelto): la próxima fecha y la mora.
 *
 * 🔴 Reemplaza la regla «¿ESTE pago cubre una cuota?» de `creditPatchAfterPayment`, que no acumulaba (dos pagos de 3.000 contra una cuota
 * de 5.208,33 nunca la cubrían) y avanzaba un solo período aunque el pago cubriera varias. Ahora el estado sale de TODO lo pagado:
 *  · la próxima fecha es la de la cuota impaga más antigua (o, al día, la siguiente con saldo): lo que muestra `creditView`;
 *  · la mora son los días desde la cuota vencida más antigua, con el método del crédito (D20) aplicado encima.
 */
export function creditPatchFromPlan(p: { metadata: unknown; plan: UpdatedPlan; creditPaid: boolean; now: Date }): CreditPatchAfterPayment {
  const meta = readCreditMetadata(p.metadata);
  const nextDueDate = p.plan.nextPayment?.dueDate ?? meta.nextDueDate;
  const patch: CreditPatchAfterPayment = {};

  // En cartera de un core ajeno manda la fuente: no se recalcula la mora (spec §6). Sólo la próxima fecha.
  const external = isExternalOrigin(meta.origin);
  const reading = p.creditPaid || external
    ? { daysPastDue: 0, arrearsSince: undefined as string | undefined }
    : withArrearsMethod({
        baseDays: p.plan.baseDaysPastDue,
        method: meta.arrearsMethod,
        oldestUnpaidDue: p.plan.oldestOverdueDueDate,
        arrearsSince: meta.arrearsSince,
        asOf: p.now,
      });
  if (!external) patch.daysPastDue = reading.daysPastDue;

  const arrearsSince = external ? meta.arrearsSince : reading.arrearsSince;
  if (nextDueDate !== meta.nextDueDate || arrearsSince !== meta.arrearsSince) {
    patch.metadata = stripUndefined({ ...meta, nextDueDate, arrearsSince });
  }
  return patch;
}

