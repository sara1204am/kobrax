/**
 * Matemática pura de créditos: generación de cronograma (amortización) y cálculo de mora.
 * Sin dependencias de Nest/Prisma → totalmente testeable. Trabaja en céntimos (enteros)
 * para evitar errores de coma flotante; expone montos en unidades con 2 decimales.
 *
 * Convención: `interestRate` es la tasa **por período (por cuota)**, no anual. La frecuencia
 * de las cuotas es mensual (la `dueDate` de la cuota i = firstDueDate + (i-1) meses).
 */
export type AmortizationType = 'FRENCH' | 'FLAT';

export interface ScheduleItem {
  number: number;
  dueDate: Date;
  amount: number; // cuota total (capital + interés)
  principal: number;
  interest: number;
}

const toCents = (units: number): number => Math.round(units * 100);
const toUnits = (cents: number): number => cents / 100;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Genera el cronograma. Invariante garantizada por construcción:
 * Σ amount = principal + Σ interest, y Σ principal = principal (la última cuota absorbe el redondeo).
 */
export function buildSchedule(params: {
  principal: number;
  periodicRate: number;
  count: number;
  type: AmortizationType;
  firstDueDate: Date;
}): ScheduleItem[] {
  const { periodicRate: r, count: n, type, firstDueDate } = params;
  const P = toCents(params.principal);
  if (n < 1) return [];

  const items: ScheduleItem[] = [];

  if (type === 'FLAT') {
    const principalPer = Math.round(P / n);
    const interestPer = Math.round(P * r);
    let principalAcc = 0;
    for (let i = 1; i <= n; i++) {
      const principalCents = i === n ? P - principalAcc : principalPer;
      principalAcc += principalCents;
      items.push(item(i, principalCents, interestPer, firstDueDate));
    }
    return items;
  }

  // FRENCH (cuota constante). Si r=0, cuota = P/n.
  const paymentCents =
    r === 0 ? Math.round(P / n) : Math.round((P * r) / (1 - Math.pow(1 + r, -n)));
  let balance = P;
  for (let i = 1; i <= n; i++) {
    const interestCents = Math.round(balance * r);
    let principalCents: number;
    let amountCents: number;
    if (i === n) {
      principalCents = balance; // absorbe el remanente
      amountCents = principalCents + interestCents;
    } else {
      amountCents = paymentCents;
      principalCents = amountCents - interestCents;
    }
    balance -= principalCents;
    items.push({
      number: i,
      dueDate: addMonths(firstDueDate, i - 1),
      amount: toUnits(amountCents),
      principal: toUnits(principalCents),
      interest: toUnits(interestCents),
    });
  }
  return items;
}

function item(i: number, principalCents: number, interestCents: number, firstDueDate: Date): ScheduleItem {
  return {
    number: i,
    dueDate: addMonths(firstDueDate, i - 1),
    amount: toUnits(principalCents + interestCents),
    principal: toUnits(principalCents),
    interest: toUnits(interestCents),
  };
}

/** True si Σ cuotas = principal + Σ interés (±1 céntimo). Guarda de seguridad. */
export function scheduleIsBalanced(principal: number, items: ScheduleItem[]): boolean {
  const sumAmount = toCents(items.reduce((s, it) => s + it.amount, 0));
  const sumInterest = toCents(items.reduce((s, it) => s + it.interest, 0));
  return Math.abs(sumAmount - (toCents(principal) + sumInterest)) <= 1;
}

// ── Mora ──────────────────────────────────────────────────────────────────────
export interface ArrearParams {
  /** Interés moratorio por día (fracción, p.ej. 0.001 = 0.1%/día). */
  dailyMoratoriumRate: number;
  /** Penalización única como fracción del monto en mora (p.ej. 0.02 = 2%). */
  penaltyRate: number;
  /** Días de gracia antes de considerar mora. */
  graceDays: number;
}

export const DEFAULT_ARREAR_PARAMS: ArrearParams = {
  dailyMoratoriumRate: 0.001,
  penaltyRate: 0,
  graceDays: 0,
};

export interface ArrearInstallment {
  id: string;
  dueDate: Date;
  amount: number;
  paidAmount: number;
  status: string;
}

export interface ArrearResult {
  daysOverdue: number;
  overdueAmount: number;
  interest: number;
  penalty: number;
  overdueInstallmentIds: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Calcula la mora a la fecha `asOf` (determinista: misma entrada → mismo resultado).
 * Una cuota está en mora si no está pagada y `dueDate + graceDays < asOf`.
 */
export function computeArrears(
  installments: ArrearInstallment[],
  params: ArrearParams,
  asOf: Date,
): ArrearResult {
  const overdue = installments.filter(
    (i) => i.status !== 'PAID' && addMonthsDays(i.dueDate, params.graceDays).getTime() < asOf.getTime(),
  );
  if (overdue.length === 0) {
    return { daysOverdue: 0, overdueAmount: 0, interest: 0, penalty: 0, overdueInstallmentIds: [] };
  }
  const overdueAmount = round2(overdue.reduce((s, i) => s + (i.amount - i.paidAmount), 0));
  const oldest = overdue.reduce((min, i) => (i.dueDate < min ? i.dueDate : min), overdue[0]!.dueDate);
  const daysOverdue = Math.max(
    0,
    Math.floor((asOf.getTime() - addMonthsDays(oldest, params.graceDays).getTime()) / DAY_MS),
  );
  const interest = round2(overdueAmount * params.dailyMoratoriumRate * daysOverdue);
  const penalty = round2(overdueAmount * params.penaltyRate);
  return {
    daysOverdue,
    overdueAmount,
    interest,
    penalty,
    overdueInstallmentIds: overdue.map((i) => i.id),
  };
}

/** Suma `days` días a una fecha (para los días de gracia). */
function addMonthsDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
