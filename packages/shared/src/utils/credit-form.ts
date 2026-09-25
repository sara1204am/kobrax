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
  CreditDefinition,
  InterestBase,
  InterestType,
  PaymentFrequency,
  RepaymentForm,
} from '../enums/credit.enum.js';
import type { NewCreditInput } from '../types/client.types.js';
import {
  calculateCredit,
  resolveCreditTerms,
  type CreditCalculation,
  type CreditTerms,
  type CreditTermsIssue,
} from './credit-engine.js';

/** Lo que hay en pantalla. Los números son texto, como los da un `<input>`. */
export interface CreditForm {
  definition: CreditDefinition;
  principal: string;
  /** Calculado: % por período (o del total, con base `TOTAL`). */
  ratePercent: string;
  rateBase: InterestBase;
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
  frequency: PaymentFrequency;
  /** YYYY-MM-DD. El primer pago (o el único). */
  firstDueDate: string;
  notes: string;
}

/** Campos que pueden faltar. La pantalla los usa para no gritar errores sobre lo que todavía no se tipeó. */
export type CreditFormField = 'principal' | 'ratePercent' | 'installmentAmount' | 'agreedTotal' | 'installmentsCount' | 'firstDueDate';

export function initialCreditForm(todayIso: string): CreditForm {
  return {
    definition: CreditDefinition.CALCULATED,
    principal: '',
    ratePercent: '',
    rateBase: InterestBase.PER_PERIOD,
    interestType: InterestType.SIMPLE,
    amortization: AmortizationMethod.FIXED_INSTALLMENT,
    installmentAmount: '',
    agreedTotal: '',
    repayment: RepaymentForm.SINGLE,
    installmentsCount: '',
    frequency: PaymentFrequency.MONTHLY,
    firstDueDate: todayIso,
    notes: '',
  };
}

/** Texto → número; vacío o ilegible → `NaN`, que el motor reporta como dato inválido (nunca un 0 inventado). */
const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s));

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
        // La base sólo viaja donde aplica: cambiar a compuesto no deja una base huérfana que invalide.
        ...(rateBaseApplies(f) ? { rateBase: f.rateBase } : {}),
        interestType: f.interestType,
        amortization: f.amortization,
        periods: num(f.installmentsCount),
        frequency: f.frequency,
        firstDueDate: f.firstDueDate,
      };
    case CreditDefinition.AGREED_INSTALLMENT:
      return {
        definition: CreditDefinition.AGREED_INSTALLMENT,
        principal,
        installmentAmount: num(f.installmentAmount),
        // Vacío = préstamo abierto (D12).
        ...(f.installmentsCount.trim() !== '' ? { installmentsCount: num(f.installmentsCount) } : {}),
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
          ? { installmentsCount: num(f.installmentsCount), frequency: f.frequency }
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
  // Capital fijo: el motor lo calcula, pero la API todavía no lo registra (Fase 6).
  const persistable = !calculation.quote?.installmentVaries;
  return {
    terms,
    calculation,
    missing,
    issues: missing.length > 0 ? [] : calculation.issues,
    canSubmit: missing.length === 0 && calculation.ok && persistable,
  };
}

/**
 * El alta que se manda: las condiciones más los campos sueltos **derivados de ellas** por la misma
 * regla que aplica la API (D14), así nunca pueden contradecirse. `null` si no se puede guardar.
 *
 * `openCase` y `origin` los pone quien llama (el BFF), igual que con `buildPrestamoPayload`.
 */
export function buildNewCreditPayload(f: CreditForm, clientId: string): NewCreditInput | null {
  if (!creditFormState(f).canSubmit) return null;
  const terms = creditFormTerms(f);
  const r = resolveCreditTerms(terms, { principalAmount: terms.principal });
  if (!r.ok) return null;
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
  };
}
