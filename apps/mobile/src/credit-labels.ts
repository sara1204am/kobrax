/**
 * Los rótulos del crédito en el móvil (F4/06 · Fase 5). Los mismos textos que la web
 * (`apps/web/src/messages/es.json`, `portfolio.creditForm`): el móvil no tiene i18n todavía.
 */
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  PaymentFrequency,
  RepaymentForm,
  type CreditTermsIssueCode,
  type ImportTrackedField,
  type InitialStateIssueCode,
} from '@kobrax/shared';

/** Todas las frecuencias, también las que el alta todavía no ofrece: un crédito puede tenerlas. */
export const FREQUENCY_LABEL: Record<PaymentFrequency, string> = {
  [PaymentFrequency.DAILY]: 'Diario',
  [PaymentFrequency.WEEKLY]: 'Semanal',
  [PaymentFrequency.BIWEEKLY]: 'Quincenal',
  [PaymentFrequency.MONTHLY]: 'Mensual',
  [PaymentFrequency.QUARTERLY]: 'Trimestral',
  [PaymentFrequency.SEMIANNUAL]: 'Semestral',
  [PaymentFrequency.ANNUAL]: 'Anual',
};

export const DEFINITION_LABEL: Record<CreditDefinition, string> = {
  [CreditDefinition.CALCULATED]: 'Calcular cuotas',
  [CreditDefinition.AGREED_INSTALLMENT]: 'Cuota acordada',
  [CreditDefinition.AGREED_TOTAL]: 'Total acordado',
};

export const DEFINITION_HINT: Record<CreditDefinition, string> = {
  [CreditDefinition.CALCULATED]: 'La cuota sale del interés, el número de cuotas y la frecuencia.',
  [CreditDefinition.AGREED_INSTALLMENT]: 'Ya sabés cuánto va a pagar por cuota. No hace falta una tasa.',
  [CreditDefinition.AGREED_TOTAL]: 'Acordaron cuánto devuelve en total. No hace falta una tasa.',
};

export const REPAYMENT_LABEL: Record<RepaymentForm, string> = {
  [RepaymentForm.SINGLE]: 'Pago único',
  [RepaymentForm.INSTALLMENTS]: 'En cuotas',
};

export const INTEREST_TYPE_LABEL: Record<InterestType, string> = {
  [InterestType.SIMPLE]: 'Simple',
  [InterestType.COMPOUND]: 'Compuesto',
};

export const AMORTIZATION_LABEL: Record<AmortizationMethod, string> = {
  [AmortizationMethod.FIXED_INSTALLMENT]: 'Cuota fija',
  [AmortizationMethod.FIXED_PRINCIPAL]: 'Capital fijo',
  [AmortizationMethod.SINGLE_PAYMENT]: 'Pago único',
};

export const RATE_BASE_LABEL: Record<InterestBase, string> = {
  [InterestBase.PER_PERIOD]: '% por período',
  [InterestBase.TOTAL]: '% total',
};

export const TERMS_ISSUE: Record<CreditTermsIssueCode, string> = {
  PRINCIPAL_INVALID: 'El monto tiene que ser mayor a 0.',
  RATE_INVALID: 'El interés no puede ser negativo.',
  RATE_OUT_OF_RANGE: 'El interés supera el máximo: 100 % por cuota o 500 % sobre el total.',
  RATE_BASE_NOT_SUPPORTED: 'El interés sobre el total sólo se aplica a interés simple con cuota fija.',
  COMBINATION_NOT_SUPPORTED: 'Esa combinación de interés y método de amortización no se ofrece.',
  PERIODS_INVALID: 'El número de cuotas tiene que ser un entero entre 1 y 600.',
  INSTALLMENT_INVALID: 'La cuota tiene que ser mayor a 0.',
  TOTAL_INVALID: 'El total tiene que ser mayor a 0.',
  FREQUENCY_REQUIRED: 'Elegí una frecuencia.',
  DATE_INVALID: 'La fecha no es válida.',
  INSTALLMENT_TOO_SMALL: 'El total no alcanza para esa cantidad de cuotas.',
  TOTAL_BELOW_PRINCIPAL: 'Vas a cobrar menos de lo que prestás. Se puede guardar igual.',
};

export const INITIAL_STATE_ISSUE: Record<InitialStateIssueCode | 'TERMS_INVALID', string> = {
  TERMS_INVALID: 'Completá las condiciones para ver cómo queda.',
  PAID_INSTALLMENTS_INVALID: 'Las cuotas pagadas tienen que ser un número entero.',
  PAID_INSTALLMENTS_TOO_MANY: 'Con todas las cuotas pagadas el préstamo está saldado, no en curso.',
  BALANCE_INVALID: 'El saldo tiene que ser mayor a 0.',
  BALANCE_ABOVE_TOTAL: 'El saldo no puede superar el total a cobrar.',
  DAYS_PAST_DUE_INVALID: 'Los días de mora tienen que ser un entero entre 0 y 3650.',
};

/** Qué dato no trajo el archivo de un importado (D9). */
export const IMPORT_FIELD_LABEL: Record<ImportTrackedField, string> = {
  principalAmount: 'monto',
  outstandingBalance: 'saldo',
  interestRate: 'tasa',
  installmentAmount: 'cuota',
  installmentsCount: 'número de cuotas',
  frequency: 'frecuencia',
  nextDueDate: 'próximo vencimiento',
  disbursedAt: 'fecha de desembolso',
  daysPastDue: 'días de mora',
};

export const ORIGIN_LABEL: Record<string, string> = {
  manual: 'Cargado a mano',
  quick_batch: 'Carga rápida',
  import: 'Importado de archivo',
  api: 'Integración',
};

export const UNKNOWN = 'No registrado';
