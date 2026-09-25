/**
 * Lógica pura de la edición del crédito (F4/06 · Fase 3): del crédito guardado al formulario, y la
 * regla D13 — «Estado al registrar» — que la API aplica al guardar y la pantalla muestra antes.
 *
 * 🔴 **Una sola regla para el saldo.** `registeredState` decide saldo, base, próximo vencimiento y
 * mora de un crédito redefinido; la API la llama para guardar y la ficha para la vista previa. Si la
 * pantalla calculara el saldo por su lado, mostraría uno y guardaría otro.
 *
 * Las condiciones y el estado al registrar sólo se editan **mientras no haya pagos registrados**:
 * después, cambiarlos reescribiría lo que ya se cobró (es una reestructura, otra operación).
 */
import { CreditDefinition, InterestBase, PaymentFrequency } from '../enums/credit.enum.js';
import type { BalanceBasis } from '../enums/credit.enum.js';
import type { CreditDetail } from '../types/client.types.js';
import { calculateCredit, type CreditTerms } from './credit-engine.js';
import { initialCreditForm, type CreditForm } from './credit-form.js';
import { addPeriods } from './periods.js';

/** Cómo venía el préstamo cuando se lo registró (D13). Se guarda en `metadata.initialState`. */
export interface CreditInitialState {
  /** Cuotas que ya se habían pagado antes de cargarlo. */
  paidInstallments: number;
  /** Saldo total pendiente que dijo quien lo carga. Ausente = se deriva del plan. */
  outstandingBalance?: number;
  /** Días de mora al registrarlo. 0 = la mora la calcula la fecha de vencimiento. */
  daysPastDue: number;
}

/** Tope de días de mora declarados (el mismo que «Marcar en mora»). */
export const MAX_INITIAL_DAYS_PAST_DUE = 3650;

export type InitialStateIssueCode =
  | 'PAID_INSTALLMENTS_INVALID'
  | 'PAID_INSTALLMENTS_TOO_MANY'
  | 'BALANCE_INVALID'
  | 'BALANCE_ABOVE_TOTAL'
  | 'DAYS_PAST_DUE_INVALID';

/** Lo que resulta de unas condiciones más el estado al registrar. */
export interface RegisteredState {
  outstandingBalance: number;
  balanceBasis: BalanceBasis;
  /** YYYY-MM-DD: la primera cuota todavía no pagada. */
  nextDueDate: string;
  daysPastDue: number;
  /** `true` si el saldo salió del plan y no de lo que se tipeó. */
  balanceDerived: boolean;
}

export type RegisteredStateResult = ({ ok: true } & RegisteredState) | { ok: false; code: InitialStateIssueCode | 'TERMS_INVALID' };

const toCents = (v: number): number => Math.round(v * 100);

/**
 * D13 — el saldo, la próxima fecha y la mora de un crédito **sin pagos registrados**:
 *  · saldo: el tipeado (base `total`) o, si no hay, el total menos las cuotas ya pagadas del plan;
 *    en el préstamo abierto, que no tiene total, el capital (base `principal`, D16);
 *  · próximo vencimiento: la primera cuota no pagada;
 *  · mora: la declarada; si es 0, la calcula después la fecha de vencimiento.
 *
 * Sin estado al registrar es exactamente el alta: saldo = total por cobrar (D15).
 */
export function registeredState(terms: CreditTerms, initial?: CreditInitialState): RegisteredStateResult {
  const calc = calculateCredit(terms);
  if (!calc.ok || !calc.quote) return { ok: false, code: 'TERMS_INVALID' };
  const { quote, schedule } = calc;

  const paid = initial?.paidInstallments ?? 0;
  if (!Number.isInteger(paid) || paid < 0) return { ok: false, code: 'PAID_INSTALLMENTS_INVALID' };
  // Con todas pagas no está «en curso»: está saldado, y eso no se registra acá.
  if (quote.installmentsCount !== null && paid >= quote.installmentsCount) return { ok: false, code: 'PAID_INSTALLMENTS_TOO_MANY' };

  const days = initial?.daysPastDue ?? 0;
  if (!Number.isInteger(days) || days < 0 || days > MAX_INITIAL_DAYS_PAST_DUE) return { ok: false, code: 'DAYS_PAST_DUE_INVALID' };

  const typed = initial?.outstandingBalance;
  if (typed !== undefined) {
    if (!Number.isFinite(typed) || toCents(typed) < 1) return { ok: false, code: 'BALANCE_INVALID' };
    if (quote.total !== null && toCents(typed) > toCents(quote.total)) return { ok: false, code: 'BALANCE_ABOVE_TOTAL' };
  }

  const nextDueDate = schedule
    ? schedule[paid]!.dueDate
    : addPeriods(new Date(`${terms.firstDueDate}T00:00:00.000Z`), paid, frequencyOf(terms)).toISOString().slice(0, 10);

  if (typed !== undefined) {
    return { ok: true, outstandingBalance: toCents(typed) / 100, balanceBasis: 'total', nextDueDate, daysPastDue: days, balanceDerived: false };
  }
  if (quote.total === null) {
    // Préstamo abierto: nadie sabe el total, el saldo nace = capital (D16).
    return { ok: true, outstandingBalance: terms.principal, balanceBasis: 'principal', nextDueDate, daysPastDue: days, balanceDerived: true };
  }
  const paidCents = (schedule ?? []).slice(0, paid).reduce((s, r) => s + toCents(r.amount), 0);
  return {
    ok: true,
    outstandingBalance: (toCents(quote.total) - paidCents) / 100,
    balanceBasis: 'total',
    nextDueDate,
    daysPastDue: days,
    balanceDerived: true,
  };
}

function frequencyOf(terms: CreditTerms): PaymentFrequency {
  return ('frequency' in terms ? terms.frequency : undefined) ?? PaymentFrequency.MONTHLY;
}

/** ¿Este estado dice algo? Uno vacío (0 pagadas, sin saldo, sin mora) no se guarda. */
export function hasInitialState(s: CreditInitialState | undefined): s is CreditInitialState {
  return Boolean(s && (s.paidInstallments > 0 || s.outstandingBalance !== undefined || s.daysPastDue > 0));
}

/** Estado al registrar desde un valor no confiable (`metadata` JSONB). `undefined` si no tiene forma. */
export function parseInitialState(raw: unknown): CreditInitialState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.paidInstallments !== 'number' || typeof r.daysPastDue !== 'number') return undefined;
  if (r.outstandingBalance !== undefined && typeof r.outstandingBalance !== 'number') return undefined;
  return {
    paidInstallments: r.paidInstallments,
    daysPastDue: r.daysPastDue,
    ...(typeof r.outstandingBalance === 'number' ? { outstandingBalance: r.outstandingBalance } : {}),
  };
}

// ── Formulario ────────────────────────────────────────────────────────────────

/** El estado al registrar en pantalla. Números como texto; vacío = 0 (o, el saldo, «que se derive»). */
export interface InitialStateForm {
  paidInstallments: string;
  outstandingBalance: string;
  daysPastDue: string;
}

export function initialStateForm(s?: CreditInitialState): InitialStateForm {
  return {
    paidInstallments: s && s.paidInstallments > 0 ? String(s.paidInstallments) : '',
    outstandingBalance: s?.outstandingBalance !== undefined ? String(s.outstandingBalance) : '',
    daysPastDue: s && s.daysPastDue > 0 ? String(s.daysPastDue) : '',
  };
}

/** Pantalla → estado. Un número ilegible pasa como `NaN` y `registeredState` lo rechaza: nunca se inventa. */
export function initialStateFromForm(f: InitialStateForm): CreditInitialState {
  const int = (s: string): number => (s.trim() === '' ? 0 : Number(s));
  return {
    paidInstallments: int(f.paidInstallments),
    daysPastDue: int(f.daysPastDue),
    ...(f.outstandingBalance.trim() !== '' ? { outstandingBalance: Number(f.outstandingBalance) } : {}),
  };
}

/**
 * Crédito guardado → el formulario de condiciones del alta, cargado.
 *
 *  · con `terms` → esas condiciones, tal cual se definieron;
 *  · sin `terms` (anterior a F4/06) → **cuota acordada** con la cuota que se está cobrando: es lo único
 *    que se sabe con certeza. Recalcularla desde la tasa mostraría un número que nadie pactó.
 */
export function creditFormFromCredit(credit: CreditDetail, todayIso: string): CreditForm {
  const base = { ...initialCreditForm(todayIso), notes: credit.notes ?? '' };
  const t = credit.terms;
  const str = (n: number | undefined): string => (n !== undefined && Number.isFinite(n) ? String(n) : '');

  if (!t) {
    return {
      ...base,
      definition: CreditDefinition.AGREED_INSTALLMENT,
      principal: str(credit.principalAmount),
      installmentAmount: str(credit.installmentAmount),
      installmentsCount: credit.installmentsCount ? String(credit.installmentsCount) : '',
      frequency: credit.frequency ?? PaymentFrequency.MONTHLY,
      firstDueDate: credit.nextDueDate?.slice(0, 10) ?? todayIso,
    };
  }

  switch (t.definition) {
    case CreditDefinition.CALCULATED:
      return {
        ...base,
        definition: t.definition,
        principal: str(t.principal),
        ratePercent: str(t.ratePercent),
        rateBase: t.rateBase ?? InterestBase.PER_PERIOD,
        interestType: t.interestType,
        amortization: t.amortization,
        installmentsCount: str(t.periods),
        frequency: t.frequency,
        firstDueDate: t.firstDueDate,
      };
    case CreditDefinition.AGREED_INSTALLMENT:
      return {
        ...base,
        definition: t.definition,
        principal: str(t.principal),
        installmentAmount: str(t.installmentAmount),
        installmentsCount: str(t.installmentsCount),
        frequency: t.frequency,
        firstDueDate: t.firstDueDate,
      };
    case CreditDefinition.AGREED_TOTAL:
      return {
        ...base,
        definition: t.definition,
        principal: str(t.principal),
        agreedTotal: str(t.agreedTotal),
        repayment: t.repayment,
        installmentsCount: str(t.installmentsCount),
        frequency: t.frequency ?? PaymentFrequency.MONTHLY,
        firstDueDate: t.firstDueDate,
      };
  }
}

/**
 * ¿Se pueden editar las condiciones y el estado al registrar? Y si no, por qué — la ficha lo dice
 * en vez de ofrecer lo que la API va a rechazar.
 */
export type TermsEditBlock = 'locked' | 'payments' | 'schedule' | null;

export function termsEditBlock(credit: Pick<CreditDetail, 'locked' | 'hasPayments' | 'hasSchedule'>): TermsEditBlock {
  if (credit.locked) return 'locked';
  if (credit.hasPayments) return 'payments';
  // Cronograma real guardado (web anterior a F4/06): se regenera recién con la Fase 6.
  if (credit.hasSchedule) return 'schedule';
  return null;
}
