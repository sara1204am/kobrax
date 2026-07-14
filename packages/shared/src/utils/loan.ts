/**
 * Matemática del préstamo tal como la define la spec (`Cliente_Prestamo.pdf` §4.2, §5.3).
 * Funciones puras, cero deps: las usan el móvil (panel en vivo, estado de la tarjeta) y la API.
 *
 * OJO — esto NO es un motor financiero. La cuota se calcula una vez, el usuario puede redondearla,
 * y se congela como valor fijo (§8: "la app es de cobranza, no core financiero"). La amortización
 * real (`buildSchedule`, sistema francés) vive en la API y solo sirve a los créditos con cronograma.
 */
import {
  CreditOrigin,
  DUE_SOON_DAYS,
  InterestBase,
  PaymentFrequency,
  PortfolioStatus,
} from '../enums/credit.enum.js';

const DAY_MS = 86_400_000;
/** Trabaja en céntimos para no arrastrar error de coma flotante. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Suma `n` períodos a una fecha según la frecuencia (§4.1). Base de "avanzar la próxima cuota".
 *
 * En UTC a propósito: las fechas de cobro se anclan a medianoche UTC en todo el sistema. Con
 * `setMonth`/`getMonth` (hora local) un `2026-07-01T00:00Z` + 1 mes caía en el **31 de julio** para
 * cualquier huso al oeste de Greenwich, o sea toda LatAm.
 */
export function addPeriods(date: Date, n: number, frequency: PaymentFrequency): Date {
  const d = new Date(date.getTime());
  switch (frequency) {
    case PaymentFrequency.DAILY:
      return new Date(d.getTime() + n * DAY_MS);
    case PaymentFrequency.WEEKLY:
      return new Date(d.getTime() + n * 7 * DAY_MS);
    case PaymentFrequency.BIWEEKLY:
      return new Date(d.getTime() + n * 14 * DAY_MS);
    case PaymentFrequency.MONTHLY:
      d.setUTCMonth(d.getUTCMonth() + n);
      return d;
  }
}

export interface LoanQuote {
  /** Cuota (§4.2). */
  installment: number;
  /** Total a cobrar = cuota × n. */
  total: number;
  /** Ganancia = total − capital (el "Interés" del panel). */
  profit: number;
}

/**
 * Panel en vivo del Modo B — Cuota / Total a cobrar / Ganancia (§4.2).
 *
 *   % por período:  cuota = capital/n + capital × i/100     ·  total = cuota × n
 *   % total:        total = capital × (1 + i/100)           ·  cuota = total / n
 *
 * Ejemplo del PDF: capital 1.000, 10% por período, 5 cuotas → cuota 300, total 1.500, ganancia 500.
 */
export function quoteLoan(params: {
  principal: number;
  interestPercent: number;
  installments: number;
  base?: InterestBase;
}): LoanQuote {
  const { principal, interestPercent: i, installments: n } = params;
  const base = params.base ?? InterestBase.PER_PERIOD;
  if (n < 1) return { installment: 0, total: 0, profit: 0 };

  const installment =
    base === InterestBase.TOTAL
      ? round2((principal * (1 + i / 100)) / n)
      : round2(principal / n + (principal * i) / 100);

  return quoteFromInstallment(principal, installment, n);
}

/**
 * El mismo panel, pero partiendo de una cuota ya fijada — Modo A, y Modo B después de que el usuario
 * la **redondea a mano** ("la cuota es editable tras el cálculo… al editarla se recalcula el total", §5.2).
 */
export function quoteFromInstallment(principal: number, installment: number, installments: number): LoanQuote {
  const total = round2(installment * installments);
  return { installment: round2(installment), total, profit: round2(total - principal) };
}

/**
 * Estado de la tarjeta de cartera (§5.3). Derivado, nunca editable.
 * Precedencia: PAGADO gana sobre todo (el saldo es 0); una promesa vigente tapa la mora
 * (el cobrador ya negoció, no hay que volver a apretar); después mora, por vencer, al día.
 */
export function portfolioStatus(
  credit: {
    outstandingBalance: number;
    daysPastDue: number;
    nextDueDate?: Date | string | null;
    hasActivePromise?: boolean;
  },
  asOf: Date = new Date(),
  dueSoonDays: number = DUE_SOON_DAYS,
): PortfolioStatus {
  if (credit.outstandingBalance <= 0.005) return PortfolioStatus.PAID;
  if (credit.hasActivePromise) return PortfolioStatus.PROMISE;
  if (credit.daysPastDue > 0) return PortfolioStatus.OVERDUE;

  const next = toDate(credit.nextDueDate);
  if (!next) return PortfolioStatus.CURRENT; // sin fecha no se puede decir "por vencer"
  const days = Math.ceil((next.getTime() - asOf.getTime()) / DAY_MS);
  if (days <= 0) return PortfolioStatus.OVERDUE; // vencida pero la mora todavía no se recalculó
  return days <= dueSoonDays ? PortfolioStatus.DUE_SOON : PortfolioStatus.CURRENT;
}

/** Días de mora de un crédito **sin cronograma**: desde `nextDueDate` si quedó saldo (§6). */
export function arrearsFromDueDate(
  nextDueDate: Date | string | null | undefined,
  outstandingBalance: number,
  asOf: Date = new Date(),
): number {
  if (outstandingBalance <= 0.005) return 0;
  const due = toDate(nextDueDate);
  if (!due) return 0;
  return Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / DAY_MS));
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── credit.metadata (JSONB) ───────────────────────────────────────────────────
/**
 * Los campos operativos de cobranza que el modelo no tiene como columnas (§7 del PDF los enumera
 * y recomienda exactamente esto). No se valida como el `details` de agenda: **no llega del cliente**,
 * lo compone el servidor desde un DTO ya validado. Acá solo se lee, con defaults tolerantes.
 */
export interface CreditMetadata {
  frequency: PaymentFrequency;
  origin: CreditOrigin;
  /** La cuota CONGELADA (§4.2). Ausente si el archivo importado no la trajo (§4.3). */
  installmentAmount?: number;
  /** ISO date (YYYY-MM-DD). "Alimenta la agenda" (§4.3). */
  nextDueDate?: string;
  /** No.Crédito del archivo — clave de upsert junto al documento (§4.3). */
  externalRef?: string;
  notes?: string;
}

export function readCreditMetadata(raw: unknown): CreditMetadata {
  const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const freq = m.frequency;
  const origin = m.origin;
  return {
    frequency: isEnumValue(PaymentFrequency, freq) ? freq : PaymentFrequency.MONTHLY,
    origin: isEnumValue(CreditOrigin, origin) ? origin : CreditOrigin.MANUAL,
    installmentAmount: typeof m.installmentAmount === 'number' ? m.installmentAmount : undefined,
    nextDueDate: typeof m.nextDueDate === 'string' ? m.nextDueDate : undefined,
    externalRef: typeof m.externalRef === 'string' ? m.externalRef : undefined,
    notes: typeof m.notes === 'string' ? m.notes : undefined,
  };
}

/**
 * El dato viene de un core ajeno (archivo o API), no de este sistema. Dos consecuencias, y son la
 * misma idea: los campos financieros **no se editan** en el móvil (§3, §4.3) y **la mora la manda la
 * fuente** — el backend no la recalcula "hasta la siguiente carga" (§6).
 *
 * `quick_batch` NO entra: es la carga rápida por lote del propio cobrador, dato suyo y editable.
 */
export function isExternalOrigin(origin: CreditOrigin): boolean {
  return origin === CreditOrigin.IMPORT || origin === CreditOrigin.API;
}

export interface CreditView extends CreditMetadata {
  /** `false` ⇒ crédito del móvil (cuota congelada en metadata). `true` ⇒ cronograma real (web/core). */
  hasSchedule: boolean;
  /** Candado de los campos financieros en la UI (§3, §4.3). */
  locked: boolean;
}

/**
 * La cuota y la próxima fecha **desde donde correspondan**: derivadas del cronograma si existe,
 * leídas del metadata si no. Fuente única — la usan el serializer de la API y el móvil, para que
 * la tarjeta de cartera diga lo mismo en los dos lados.
 */
export function creditView(credit: {
  metadata?: unknown;
  installments?: { dueDate: Date | string; amount: number; status: string }[] | null;
}): CreditView {
  const meta = readCreditMetadata(credit.metadata);
  const locked = isExternalOrigin(meta.origin);
  const schedule = credit.installments ?? [];
  if (schedule.length === 0) return { ...meta, hasSchedule: false, locked };

  const pending = schedule
    .filter((i) => i.status !== 'PAID')
    .map((i) => ({ ...i, due: toDate(i.dueDate) }))
    .filter((i): i is typeof i & { due: Date } => i.due !== null)
    .sort((a, b) => a.due.getTime() - b.due.getTime());
  const next = pending[0];

  return {
    ...meta,
    hasSchedule: true,
    locked,
    installmentAmount: next ? round2(next.amount) : meta.installmentAmount,
    nextDueDate: next ? next.due.toISOString().slice(0, 10) : undefined,
  };
}

function isEnumValue<T extends Record<string, string>>(e: T, v: unknown): v is T[keyof T] {
  return typeof v === 'string' && Object.values(e).includes(v);
}
