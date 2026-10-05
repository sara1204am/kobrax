/**
 * Cronograma de la API y cálculo de mora. Sin dependencias de Nest/Prisma → totalmente testeable.
 *
 * 🔴 El cronograma ya NO se calcula acá: `buildSchedule` es un adaptador sobre el motor único de
 * `@kobrax/shared` (`calculateCredit`, F4/06), el mismo que usa la vista previa de web y móvil. Así
 * no puede volver a haber una cuota en pantalla y otra guardada.
 *
 * Convención del contrato viejo: `periodicRate` es una **fracción** por período (0.01 = 1 %) y la
 * frecuencia es mensual. `FRENCH` = compuesto + cuota fija; `FLAT` = simple + cuota fija.
 */
import {
  AmortizationMethod,
  CreditDefinition,
  InterestType,
  PaymentFrequency,
  calculateCredit,
} from '@kobrax/shared';

export type AmortizationType = 'FRENCH' | 'FLAT';

export interface ScheduleItem {
  number: number;
  dueDate: Date;
  amount: number; // cuota total (capital + interés)
  principal: number;
  interest: number;
}

const toCents = (units: number): number => Math.round(units * 100);

/**
 * Genera el cronograma. Invariante garantizada por el motor:
 * Σ amount = principal + Σ interest, y Σ principal = principal (la última cuota absorbe el redondeo).
 * Fechas mensuales desde `firstDueDate`, en UTC, conservando el día (fin de mes → último día).
 */
export function buildSchedule(params: {
  principal: number;
  periodicRate: number;
  count: number;
  type: AmortizationType;
  firstDueDate: Date;
}): ScheduleItem[] {
  if (params.count < 1) return [];
  const calc = calculateCredit({
    definition: CreditDefinition.CALCULATED,
    principal: params.principal,
    ratePercent: params.periodicRate * 100,
    interestType: params.type === 'FRENCH' ? InterestType.COMPOUND : InterestType.SIMPLE,
    amortization: AmortizationMethod.FIXED_INSTALLMENT,
    periods: params.count,
    frequency: PaymentFrequency.MONTHLY,
    firstDueDate: params.firstDueDate.toISOString().slice(0, 10),
  });
  // Tasa fuera del rango de la pantalla: este contrato nunca lo validó y el motor igual calcula.
  return (calc.schedule ?? []).map((row) => ({
    number: row.number,
    dueDate: new Date(`${row.dueDate}T00:00:00.000Z`),
    amount: row.amount,
    principal: row.principal,
    interest: row.interest,
  }));
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
