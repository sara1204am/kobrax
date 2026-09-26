/**
 * Lógica pura del formulario "Nuevo crédito" (F4/06 · Fase 2): de lo que hay tipeado en pantalla a
 * `CreditTerms`, qué falta, si se puede guardar y qué se manda.
 *
 * 🔴 **No calcula nada.** Arma las condiciones y se las pasa al motor único (`calculateCredit`) y a
 * la regla D14 (`resolveCreditTerms`): la vista previa y lo que la API guarda salen de la misma
 * función. Vive en shared para que el móvil (Fase 5) use exactamente esta capa.
 *
 * Reemplaza a `loan-form.ts` (modos A/B + "ya está en curso") en el alta. Aquél sigue vivo para la
 * ficha del crédito y el móvil hasta las Fases 3 y 5.
 */
import {
  AmortizationMethod,
  ArrearsMethod,
  ChargeTiming,
  CreditDefinition,
  DEFAULT_ARREARS_METHOD,
  InterestBase,
  InterestType,
  PAYMENTS_PER_YEAR,
  PaymentFrequency,
  RateConvention,
  RatePeriod,
  RepaymentForm,
  TermUnit,
} from '../enums/credit.enum.js';
import type { NewCreditInput } from '../types/client.types.js';
import {
  calculateCredit,
  resolveCreditTerms,
  type CreditCalculation,
  type CreditCharge,
  type CreditTerms,
  type CreditTermsIssue,
} from './credit-engine.js';
import { hasInitialState, registeredState, type CreditInitialState } from './credit-edit.js';

/** Lo que hay en pantalla. Los números son texto, como los da un `<input>`. */
export interface CreditForm {
  definition: CreditDefinition;
  principal: string;
  /** Calculado: % por período (o del total, con base `TOTAL`). */
  ratePercent: string;
  /** A qué período se refiere el %: por cuota, mensual… anual (D17). Independiente de la frecuencia. */
  ratePeriod: RatePeriod;
  /** Nominal (proporcional) o efectiva, cuando el % no es por cuota (D17). */
  rateConvention: RateConvention;
  rateBase: InterestBase;
  /** Desgravamen, % mensual sobre el saldo (D18). Vacío = sin seguro. */
  insuranceMonthlyPercent: string;
  /** Otros cargos (D18). */
  charges: CreditFormCharge[];
  /** Cómo se cuentan los días de mora (D20). No es una condición del plan: no entra en `terms`. */
  arrearsMethod: ArrearsMethod;
  interestType: InterestType;
  amortization: AmortizationMethod;
  /** Cuota acordada. */
  installmentAmount: string;
  /** Total acordado. */
  agreedTotal: string;
  repayment: RepaymentForm;
  /**
   * Número de cuotas, compartido por las tres definiciones para no perderlo al cambiar de una a otra.
   * En pago único calculado es el plazo en períodos; en cuota acordada, vacío = préstamo abierto.
   */
  installmentsCount: string;
  /** En qué unidad está `installmentsCount`: cuotas, meses o años (D17). Se guarda convertido a cuotas. */
  termUnit: TermUnit;
  frequency: PaymentFrequency;
  /** YYYY-MM-DD. El primer pago (o el único). */
  firstDueDate: string;
  notes: string;
}

/** Campos que pueden faltar. La pantalla los usa para no gritar errores sobre lo que todavía no se tipeó. */
/**
 * Un cargo en pantalla (D18). El tipo junta cuándo y cómo se cobra, como lo elige quien carga:
 *  · `per_installment` — monto fijo en cada cuota;
 *  · `first_amount` / `first_percent` — una vez, en la primera cuota: monto fijo o % del monto;
 *  · `deducted_amount` / `deducted_percent` — descontado del desembolso: monto fijo o % del monto.
 */
export const CHARGE_KINDS = ['per_installment', 'first_amount', 'first_percent', 'deducted_amount', 'deducted_percent'] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export interface CreditFormCharge {
  /** Clave de la fila en pantalla; no viaja. */
  id: string;
  label: string;
  kind: ChargeKind;
  value: string;
}

/** Cargo en pantalla → cargo del motor. Un valor vacío o ilegible pasa como `NaN` y el motor lo rechaza. */
export function chargeFromForm(c: CreditFormCharge): CreditCharge {
  const v = num(c.value);
  const label = c.label.trim() ? { label: c.label.trim() } : {};
  switch (c.kind) {
    case 'per_installment':
      return { ...label, timing: ChargeTiming.PER_INSTALLMENT, amount: v };
    case 'first_amount':
      return { ...label, timing: ChargeTiming.FIRST_INSTALLMENT, amount: v };
    case 'first_percent':
      return { ...label, timing: ChargeTiming.FIRST_INSTALLMENT, percent: v };
    case 'deducted_amount':
      return { ...label, timing: ChargeTiming.DEDUCTED, amount: v };
    case 'deducted_percent':
      return { ...label, timing: ChargeTiming.DEDUCTED, percent: v };
  }
}

/** Cargo del motor → cargo en pantalla (al reabrir un crédito). */
export function chargeToForm(c: CreditCharge, id: string): CreditFormCharge {
  const percent = c.percent !== undefined;
  const kind: ChargeKind =
    c.timing === ChargeTiming.PER_INSTALLMENT
      ? 'per_installment'
      : c.timing === ChargeTiming.FIRST_INSTALLMENT
        ? percent
          ? 'first_percent'
          : 'first_amount'
        : percent
          ? 'deducted_percent'
          : 'deducted_amount';
  return { id, label: c.label ?? '', kind, value: String(percent ? c.percent : c.amount) };
}

export type CreditFormField ='principal' | 'ratePercent' | 'installmentAmount' | 'agreedTotal' | 'installmentsCount' | 'firstDueDate';

export function initialCreditForm(todayIso: string): CreditForm {
  return {
    definition: CreditDefinition.CALCULATED,
    principal: '',
    ratePercent: '',
    // Como lo dice el banco: «18 % anual a 3 años» (pedido de la usuaria, 2026-09-25).
    ratePeriod: RatePeriod.ANNUAL,
    rateConvention: RateConvention.NOMINAL,
    rateBase: InterestBase.PER_PERIOD,
    insuranceMonthlyPercent: '',
    charges: [],
    // Quien llama pone el default de la cuenta (`AccountInfo.arrearsMethod`).
    arrearsMethod: DEFAULT_ARREARS_METHOD,
    interestType: InterestType.SIMPLE,
    amortization: AmortizationMethod.FIXED_INSTALLMENT,
    installmentAmount: '',
    agreedTotal: '',
    repayment: RepaymentForm.SINGLE,
    installmentsCount: '',
    // Calcular cuotas pregunta el período en años o meses, no en cuotas.
    termUnit: TermUnit.YEARS,
    frequency: PaymentFrequency.MONTHLY,
    firstDueDate: todayIso,
    notes: '',
  };
}

/** Texto → número; vacío o ilegible → `NaN`, que el motor reporta como dato inválido (nunca un 0 inventado). */
const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s));

/**
 * Plazo en pantalla → número de cuotas (D17). 3 años mensual = 36; 1 año semanal = 52. Un plazo que no da
 * cuotas enteras (1 mes semanal = 4,33) vuelve `NaN`: se avisa, no se redondea.
 */
export function termInstallments(value: string, unit: TermUnit, frequency: PaymentFrequency): number {
  const v = num(value);
  if (unit === TermUnit.INSTALLMENTS || !Number.isFinite(v)) return v;
  const perYear = PAYMENTS_PER_YEAR[frequency];
  const n = unit === TermUnit.YEARS ? v * perYear : (v * perYear) / 12;
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 1e-9 ? rounded : Number.NaN;
}

/**
 * Cuotas guardadas → meses, para volver a mostrar en meses el período de un crédito calculado.
 * `null` si no da meses enteros (10 cuotas semanales): ahí se muestra en cuotas, sin inventar.
 */
export function installmentsToMonths(n: number, frequency: PaymentFrequency): number | null {
  if (!Number.isFinite(n)) return null;
  const months = (n * 12) / PAYMENTS_PER_YEAR[frequency];
  return Math.abs(months - Math.round(months)) < 1e-9 ? Math.round(months) : null;
}

/** ¿La tasa puede tener período propio? No con "% del total", que se aplica una vez sobre todo el préstamo. */
export function ratePeriodApplies(f: Pick<CreditForm, 'rateBase' | 'interestType' | 'amortization'>): boolean {
  return !(rateBaseApplies(f) && f.rateBase === InterestBase.TOTAL);
}

/** ¿La base "% del total" aplica? Sólo simple + cuota fija (D8). */
export function rateBaseApplies(f: Pick<CreditForm, 'interestType' | 'amortization'>): boolean {
  return f.interestType === InterestType.SIMPLE && f.amortization === AmortizationMethod.FIXED_INSTALLMENT;
}

/** Pantalla → condiciones. Siempre arma unas; si están incompletas, el motor lo dice en `issues`. */
export function creditFormTerms(f: CreditForm): CreditTerms {
  const principal = num(f.principal);
  switch (f.definition) {
    case CreditDefinition.CALCULATED:
      return {
        definition: CreditDefinition.CALCULATED,
        principal,
        ratePercent: num(f.ratePercent),
        // D17: el período de la tasa sólo viaja si no es por cuota, y la convención sólo si es efectiva.
        ...(ratePeriodApplies(f) && f.ratePeriod !== RatePeriod.PER_INSTALLMENT
          ? { ratePeriod: f.ratePeriod, ...(f.rateConvention === RateConvention.EFFECTIVE ? { rateConvention: f.rateConvention } : {}) }
          : {}),
        // La base sólo viaja donde aplica: cambiar a compuesto no deja una base huérfana que invalide.
        ...(rateBaseApplies(f) ? { rateBase: f.rateBase } : {}),
        interestType: f.interestType,
        amortization: f.amortization,
        periods: termInstallments(f.installmentsCount, f.termUnit, f.frequency),
        // D18: sólo viajan si hay algo. Un % vacío es «sin seguro», no un error.
        ...(f.insuranceMonthlyPercent.trim() !== '' ? { insuranceMonthlyPercent: num(f.insuranceMonthlyPercent) } : {}),
        ...(f.charges.length > 0 ? { charges: f.charges.map(chargeFromForm) } : {}),
        frequency: f.frequency,
        firstDueDate: f.firstDueDate,
      };
    case CreditDefinition.AGREED_INSTALLMENT:
      return {
        definition: CreditDefinition.AGREED_INSTALLMENT,
        principal,
        installmentAmount: num(f.installmentAmount),
        // Vacío = préstamo abierto (D12).
        ...(f.installmentsCount.trim() !== '' ? { installmentsCount: termInstallments(f.installmentsCount, f.termUnit, f.frequency) } : {}),
        frequency: f.frequency,
        firstDueDate: f.firstDueDate,
      };
    case CreditDefinition.AGREED_TOTAL:
      return {
        definition: CreditDefinition.AGREED_TOTAL,
        principal,
        agreedTotal: num(f.agreedTotal),
        repayment: f.repayment,
        ...(f.repayment === RepaymentForm.INSTALLMENTS
          ? { installmentsCount: termInstallments(f.installmentsCount, f.termUnit, f.frequency), frequency: f.frequency }
          : {}),
        firstDueDate: f.firstDueDate,
      };
  }
}

/** Lo que todavía no se tipeó y hace falta para esta definición. */
export function creditFormMissing(f: CreditForm): CreditFormField[] {
  const required: CreditFormField[] = ['principal', 'firstDueDate'];
  if (f.definition === CreditDefinition.CALCULATED) required.push('ratePercent', 'installmentsCount');
  if (f.definition === CreditDefinition.AGREED_INSTALLMENT) required.push('installmentAmount');
  if (f.definition === CreditDefinition.AGREED_TOTAL) {
    required.push('agreedTotal');
    if (f.repayment === RepaymentForm.INSTALLMENTS) required.push('installmentsCount');
  }
  return required.filter((k) => f[k].trim() === '');
}

export interface CreditFormState {
  terms: CreditTerms;
  calculation: CreditCalculation;
  /** Campos vacíos: mientras haya alguno, la pantalla no muestra errores del motor, sólo "completá…". */
  missing: CreditFormField[];
  /** Errores y avisos del motor, sólo cuando el formulario ya está completo. */
  issues: CreditTermsIssue[];
  canSubmit: boolean;
}

/** Todo lo que la pantalla necesita, de una vez: condiciones, cálculo, faltantes, avisos y si se puede guardar. */
export function creditFormState(f: CreditForm): CreditFormState {
  const terms = creditFormTerms(f);
  const calculation = calculateCredit(terms);
  const missing = creditFormMissing(f);
  // Un plazo en meses/años que no da cuotas enteras se dice como tal, no como «número de cuotas inválido».
  const termNotWhole =
    f.termUnit !== TermUnit.INSTALLMENTS && f.installmentsCount.trim() !== '' && Number.isNaN(termInstallments(f.installmentsCount, f.termUnit, f.frequency));
  const issues = termNotWhole
    ? [{ code: 'TERM_NOT_WHOLE' as const, severity: 'error' as const }, ...calculation.issues.filter((i) => i.code !== 'PERIODS_INVALID')]
    : calculation.issues;
  return {
    terms,
    calculation,
    missing,
    issues: missing.length > 0 ? [] : issues,
    canSubmit: missing.length === 0 && calculation.ok,
  };
}

/**
 * El alta que se manda: las condiciones más los campos sueltos **derivados de ellas** por la misma
 * regla que aplica la API (D14), así nunca pueden contradecirse. `null` si no se puede guardar.
 *
 * `openCase` y `origin` los pone quien llama (el BFF), igual que con `buildPrestamoPayload`.
 */
export function buildNewCreditPayload(f: CreditForm, clientId: string, initialState?: CreditInitialState): NewCreditInput | null {
  if (!creditFormState(f).canSubmit) return null;
  const terms = creditFormTerms(f);
  const r = resolveCreditTerms(terms, { principalAmount: terms.principal });
  if (!r.ok) return null;
  // «Ya está en curso» (D13): sólo viaja si dice algo y cierra con las condiciones.
  const initial = hasInitialState(initialState) ? initialState : undefined;
  if (initial && !registeredState(terms, initial).ok) return null;
  return {
    clientId,
    principalAmount: terms.principal,
    installmentAmount: r.installmentAmount,
    frequency: r.frequency,
    nextDueDate: r.nextDueDate,
    installmentsCount: r.installmentsCount > 0 ? r.installmentsCount : undefined, // 0 = abierto
    interestRate: terms.definition === CreditDefinition.CALCULATED ? terms.ratePercent : undefined,
    notes: f.notes.trim() || undefined,
    terms,
    ...(initial ? { initialState: initial } : {}),
    arrearsMethod: f.arrearsMethod,
  };
}
