/**
 * Motor financiero único del crédito (F4/06 · Fase 1).
 *
 * 🔴 **Una sola función para todo lo que muestra o guarda plata.** La vista previa del alta (web y
 * móvil), la validación de la API y —cuando llegue— el cronograma guardado salen de `calculateCredit`.
 * Antes había dos matemáticas: la cotización plana de la pantalla y el francés de la API. Mostrar un
 * plan con una fórmula y cobrar con otra es un error que aparece meses después, en la boca de un cliente.
 *
 * Reglas (docs/epics/F4/06-refactor-creditos-ux.md):
 *  · D2/D3 — tipo de interés y método de amortización son ejes distintos. Francés ≠ compuesto.
 *  · D4 — compuesto + capital fijo no se ofrece (da lo mismo que simple + capital fijo).
 *  · D7 — la tasa es un **porcentaje** (`ratePercent: 10` = 10 %), por período.
 *  · D8 — la base "% del total" sólo aplica a simple + cuota fija.
 *  · D11 — con cuota o total acordado, cada fila reparte capital = P/n e interés = cuota − P/n.
 *  · D12 — cuota acordada sin número de cuotas = préstamo abierto: hay cuota, no hay plan.
 *
 * Trabaja en céntimos enteros; la última fila absorbe el redondeo, así Σ capital = capital prestado
 * y el saldo final es exactamente 0.
 */
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  PaymentFrequency,
  RepaymentForm,
} from '../enums/credit.enum.js';
import { addPeriods } from './periods.js';

// ── Contrato ──────────────────────────────────────────────────────────────────

/** Condiciones de un crédito calculado: el motor manda en la cuota (D14). */
export interface CalculatedTerms {
  definition: CreditDefinition.CALCULATED;
  principal: number;
  /** Porcentaje por período (D7). Con `rateBase: TOTAL`, porcentaje sobre todo el préstamo. */
  ratePercent: number;
  rateBase?: InterestBase;
  interestType: InterestType;
  amortization: AmortizationMethod;
  /** Número de cuotas. En pago único: los períodos del plazo, sobre los que corre el interés. */
  periods: number;
  frequency: PaymentFrequency;
  /** YYYY-MM-DD. En pago único es la fecha del pago. */
  firstDueDate: string;
}

/** Cuota acordada: la cuota del usuario es contractual; el motor sólo deriva (D14). */
export interface AgreedInstallmentTerms {
  definition: CreditDefinition.AGREED_INSTALLMENT;
  principal: number;
  installmentAmount: number;
  /** Ausente = préstamo abierto (D12): hay cuota, no hay plan. */
  installmentsCount?: number;
  frequency: PaymentFrequency;
  firstDueDate: string;
}

/** Total acordado: el total del usuario es contractual; no se inventa una tasa (D14). */
export interface AgreedTotalTerms {
  definition: CreditDefinition.AGREED_TOTAL;
  principal: number;
  agreedTotal: number;
  repayment: RepaymentForm;
  /** Obligatorio si `repayment` es en cuotas. */
  installmentsCount?: number;
  /** Obligatorio si `repayment` es en cuotas. */
  frequency?: PaymentFrequency;
  /** YYYY-MM-DD. En pago único es la fecha del pago. */
  firstDueDate: string;
}

export type CreditTerms = CalculatedTerms | AgreedInstallmentTerms | AgreedTotalTerms;

export interface CreditScheduleRow {
  number: number;
  /** YYYY-MM-DD */
  dueDate: string;
  principal: number;
  interest: number;
  /** Cuota de la fila = capital + interés. */
  amount: number;
  /** Saldo de capital después de pagar la fila. */
  principalBalance: number;
}

export interface CreditQuote {
  /** La cuota; con capital fijo, la primera (las siguientes bajan). */
  installment: number;
  /** `true` si las cuotas no son todas iguales (capital fijo). */
  installmentVaries: boolean;
  /** `null` en el préstamo abierto. */
  installmentsCount: number | null;
  /** Total a cobrar = Σ cuotas. `null` en el préstamo abierto. */
  total: number | null;
  /** Ganancia = total − capital. `null` en el préstamo abierto. */
  profit: number | null;
}

export type CreditTermsIssueCode =
  | 'PRINCIPAL_INVALID'
  | 'RATE_INVALID'
  | 'RATE_OUT_OF_RANGE'
  | 'RATE_BASE_NOT_SUPPORTED'
  | 'COMBINATION_NOT_SUPPORTED'
  | 'PERIODS_INVALID'
  | 'INSTALLMENT_INVALID'
  | 'TOTAL_INVALID'
  | 'FREQUENCY_REQUIRED'
  | 'DATE_INVALID'
  | 'INSTALLMENT_TOO_SMALL'
  | 'TOTAL_BELOW_PRINCIPAL';

export interface CreditTermsIssue {
  code: CreditTermsIssueCode;
  /** `error` impide guardar; `warning` se muestra y se puede guardar igual. */
  severity: 'error' | 'warning';
}

export interface CreditCalculation {
  /** Sin issues de severidad `error`. La API guarda sólo si es `true`. */
  ok: boolean;
  /** `null` si faltan datos para calcular. Puede venir aunque `ok` sea `false` (p.ej. tasa fuera de rango). */
  quote: CreditQuote | null;
  /** `null` si no hay plan: préstamo abierto, fecha inválida o datos insuficientes. */
  schedule: CreditScheduleRow[] | null;
  issues: CreditTermsIssue[];
}

/** Máximo de cuotas / períodos (el mismo tope que el DTO de la API). */
export const MAX_CREDIT_PERIODS = 600;
/** Tasa máxima por período, en %. Con base "% del total" el tope es `MAX_RATE_TOTAL_PERCENT`. */
export const MAX_RATE_PER_PERIOD_PERCENT = 100;
export const MAX_RATE_TOTAL_PERCENT = 500;
/**
 * Diferencia de redondeo que la API absorbe en un crédito calculado (D14): una cuota del cliente a
 * ±1 céntimo de la del motor se normaliza a la del motor; más que eso se rechaza.
 */
export const INSTALLMENT_TOLERANCE = 0.01;

// ── Motor ─────────────────────────────────────────────────────────────────────

export function calculateCredit(terms: CreditTerms): CreditCalculation {
  switch (terms.definition) {
    case CreditDefinition.CALCULATED:
      return calculated(terms);
    case CreditDefinition.AGREED_INSTALLMENT:
      return agreedInstallment(terms);
    case CreditDefinition.AGREED_TOTAL:
      return agreedTotal(terms);
  }
}

/** Filas en céntimos, antes de ponerles fecha. */
interface RawRow {
  principal: number;
  interest: number;
}

function calculated(t: CalculatedTerms): CreditCalculation {
  const issues: CreditTermsIssue[] = [];
  const P = principalCents(t.principal, issues);
  const n = periodsOf(t.periods, issues);
  if (!isFiniteNumber(t.ratePercent) || t.ratePercent < 0) issues.push(err('RATE_INVALID'));
  if (!t.frequency) issues.push(err('FREQUENCY_REQUIRED'));

  const base = t.rateBase ?? InterestBase.PER_PERIOD;
  const isSimpleLevel = t.interestType === InterestType.SIMPLE && t.amortization === AmortizationMethod.FIXED_INSTALLMENT;
  if (base === InterestBase.TOTAL && !isSimpleLevel) issues.push(err('RATE_BASE_NOT_SUPPORTED'));
  if (t.interestType === InterestType.COMPOUND && t.amortization === AmortizationMethod.FIXED_PRINCIPAL) {
    issues.push(err('COMBINATION_NOT_SUPPORTED'));
  }
  if (isFiniteNumber(t.ratePercent)) {
    const max = base === InterestBase.TOTAL ? MAX_RATE_TOTAL_PERCENT : MAX_RATE_PER_PERIOD_PERCENT;
    if (t.ratePercent > max) issues.push(err('RATE_OUT_OF_RANGE'));
  }
  // Tasa fuera de rango sí se calcula (la pantalla muestra el número y avisa); lo demás, no.
  if (P === null || n === null || issues.some((i) => i.code !== 'RATE_OUT_OF_RANGE')) {
    return result(issues, null, null);
  }

  const r = t.ratePercent / 100;
  let rows: RawRow[];
  let dated: 'series' | 'single' = 'series';
  switch (t.amortization) {
    case AmortizationMethod.FIXED_INSTALLMENT:
      if (t.interestType === InterestType.COMPOUND) {
        rows = annuityRows(P, r, n);
      } else {
        // Simple + cuota fija: el interés corre sobre el capital ORIGINAL (plano). La cuota se
        // redondea desde el valor exacto —como siempre la cotizó la pantalla— y no desde el total
        // ya redondeado: así un crédito recotizado conserva su cuota al céntimo.
        const exactTotal = base === InterestBase.TOTAL ? P * (1 + r) : P + P * r * n;
        rows = levelRows(Math.round(exactTotal), P, n, Math.round(exactTotal / n));
      }
      break;
    case AmortizationMethod.FIXED_PRINCIPAL:
      rows = fixedPrincipalRows(P, r, n); // sólo simple (D4)
      break;
    case AmortizationMethod.SINGLE_PAYMENT: {
      const interest =
        t.interestType === InterestType.COMPOUND ? Math.round(P * (Math.pow(1 + r, n) - 1)) : Math.round(P * r * n);
      rows = [{ principal: P, interest }];
      dated = 'single';
      break;
    }
  }
  return finish(P, rows, t.frequency, t.firstDueDate, dated, t.amortization === AmortizationMethod.FIXED_PRINCIPAL, issues);
}

function agreedInstallment(t: AgreedInstallmentTerms): CreditCalculation {
  const issues: CreditTermsIssue[] = [];
  const P = principalCents(t.principal, issues);
  const cuota = isFiniteNumber(t.installmentAmount) && t.installmentAmount > 0 ? toCents(t.installmentAmount) : null;
  if (cuota === null || cuota < 1) issues.push(err('INSTALLMENT_INVALID'));
  if (!t.frequency) issues.push(err('FREQUENCY_REQUIRED'));

  // Préstamo abierto (D12): hay cuota, no hay número de cuotas → ni total ni plan.
  if (t.installmentsCount === undefined || t.installmentsCount === null) {
    if (P === null || cuota === null || cuota < 1 || !t.frequency) return result(issues, null, null);
    const quote: CreditQuote = { installment: toUnits(cuota), installmentVaries: false, installmentsCount: null, total: null, profit: null };
    return result(issues, quote, null);
  }

  const n = periodsOf(t.installmentsCount, issues);
  if (P === null || n === null || cuota === null || cuota < 1 || !t.frequency) return result(issues, null, null);
  return finish(P, levelRows(cuota * n, P, n), t.frequency, t.firstDueDate, 'series', false, issues);
}

function agreedTotal(t: AgreedTotalTerms): CreditCalculation {
  const issues: CreditTermsIssue[] = [];
  const P = principalCents(t.principal, issues);
  const T = isFiniteNumber(t.agreedTotal) && t.agreedTotal > 0 ? toCents(t.agreedTotal) : null;
  if (T === null || T < 1) issues.push(err('TOTAL_INVALID'));

  if (t.repayment === RepaymentForm.SINGLE) {
    if (P === null || T === null || T < 1) return result(issues, null, null);
    // Sin frecuencia: un solo pago en la fecha acordada.
    return finish(P, [{ principal: P, interest: T - P }], undefined, t.firstDueDate, 'single', false, issues);
  }

  if (!t.frequency) issues.push(err('FREQUENCY_REQUIRED'));
  const n = periodsOf(t.installmentsCount, issues);
  if (P === null || n === null || T === null || T < 1 || !t.frequency) return result(issues, null, null);
  if (T < n) {
    issues.push(err('INSTALLMENT_TOO_SMALL'));
    return result(issues, null, null);
  }
  return finish(P, levelRows(T, P, n), t.frequency, t.firstDueDate, 'series', false, issues);
}

// ── Formas de las filas (céntimos) ────────────────────────────────────────────

/**
 * Cuota nivelada a partir de un total: todas iguales, la última absorbe el redondeo. El interés
 * (total − capital) se reparte igual en todas (D11): con cuota o total acordado no hay tasa de la
 * que derivar otra cosa, y con simple + cuota fija el interés es plano por definición.
 */
function levelRows(totalCents: number, P: number, n: number, cuota: number = Math.round(totalCents / n)): RawRow[] {
  const I = totalCents - P;
  const interestPer = Math.round(I / n);
  const rows: RawRow[] = [];
  for (let i = 1; i <= n; i++) {
    const amount = i === n ? totalCents - cuota * (n - 1) : cuota;
    const interest = i === n ? I - interestPer * (n - 1) : interestPer;
    rows.push({ principal: amount - interest, interest });
  }
  return rows;
}

/** Anualidad (sistema francés): cuota constante, interés compuesto sobre el saldo. Con r=0, P/n. */
function annuityRows(P: number, r: number, n: number): RawRow[] {
  const cuota = r === 0 ? Math.round(P / n) : Math.round((P * r) / (1 - Math.pow(1 + r, -n)));
  const rows: RawRow[] = [];
  let balance = P;
  for (let i = 1; i <= n; i++) {
    const interest = Math.round(balance * r);
    const principal = i === n ? balance : cuota - interest; // la última cierra el saldo
    balance -= principal;
    rows.push({ principal, interest });
  }
  return rows;
}

/** Capital fijo: amortiza P/n por cuota, el interés corre sobre el saldo → la cuota baja. */
function fixedPrincipalRows(P: number, r: number, n: number): RawRow[] {
  const per = Math.round(P / n);
  const rows: RawRow[] = [];
  let balance = P;
  for (let i = 1; i <= n; i++) {
    const principal = i === n ? balance : per;
    rows.push({ principal, interest: Math.round(balance * r) });
    balance -= principal;
  }
  return rows;
}

// ── Armado del resultado ──────────────────────────────────────────────────────

function finish(
  P: number,
  rows: RawRow[],
  frequency: PaymentFrequency | undefined,
  firstDueDate: string,
  dated: 'series' | 'single',
  installmentVaries: boolean,
  issues: CreditTermsIssue[],
): CreditCalculation {
  const totalCents = rows.reduce((s, r) => s + r.principal + r.interest, 0);
  if (totalCents < P) issues.push({ code: 'TOTAL_BELOW_PRINCIPAL', severity: 'warning' });

  const quote: CreditQuote = {
    installment: toUnits(rows[0]!.principal + rows[0]!.interest),
    installmentVaries,
    installmentsCount: rows.length,
    total: toUnits(totalCents),
    profit: toUnits(totalCents - P),
  };

  const first = parseIsoDate(firstDueDate);
  if (!first) {
    issues.push(err('DATE_INVALID'));
    return result(issues, quote, null);
  }

  let balance = P;
  const schedule = rows.map((row, idx): CreditScheduleRow => {
    balance -= row.principal;
    const due = dated === 'single' || !frequency ? first : addPeriods(first, idx, frequency);
    return {
      number: idx + 1,
      dueDate: due.toISOString().slice(0, 10),
      principal: toUnits(row.principal),
      interest: toUnits(row.interest),
      amount: toUnits(row.principal + row.interest),
      principalBalance: toUnits(balance),
    };
  });
  return result(issues, quote, schedule);
}

function result(issues: CreditTermsIssue[], quote: CreditQuote | null, schedule: CreditScheduleRow[] | null): CreditCalculation {
  return { ok: !issues.some((i) => i.severity === 'error'), quote, schedule, issues };
}

// ── Lectura de condiciones que vienen de afuera ───────────────────────────────

/** Versión del formato de `metadata.terms`. Subirla si cambia el significado de algún campo. */
export const CREDIT_TERMS_VERSION = 1;

/**
 * Condiciones desde un valor no confiable (body de la API, `metadata` JSONB) → `CreditTerms` limpio,
 * **sólo con las claves conocidas**, o `null` si la FORMA no es válida (tipos, enums, faltantes).
 *
 * Valida la forma, no el negocio: que el capital sea positivo o la combinación exista lo dice
 * `calculateCredit` con sus `issues`. Así hay un solo lugar que decide qué es un crédito válido.
 */
export function parseCreditTerms(raw: unknown): CreditTerms | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (k: string): number | undefined => (typeof r[k] === 'number' ? (r[k] as number) : undefined);
  const date = typeof r.firstDueDate === 'string' ? r.firstDueDate : undefined;
  const frequency = enumOf(PaymentFrequency, r.frequency);
  const principal = num('principal');
  if (principal === undefined || date === undefined) return null;

  switch (r.definition) {
    case CreditDefinition.CALCULATED: {
      const ratePercent = num('ratePercent');
      const periods = num('periods');
      const interestType = enumOf(InterestType, r.interestType);
      const amortization = enumOf(AmortizationMethod, r.amortization);
      const rateBase = r.rateBase === undefined ? undefined : enumOf(InterestBase, r.rateBase);
      if (ratePercent === undefined || periods === undefined || !interestType || !amortization || !frequency) return null;
      if (r.rateBase !== undefined && !rateBase) return null;
      return {
        definition: CreditDefinition.CALCULATED,
        principal,
        ratePercent,
        ...(rateBase ? { rateBase } : {}),
        interestType,
        amortization,
        periods,
        frequency,
        firstDueDate: date,
      };
    }
    case CreditDefinition.AGREED_INSTALLMENT: {
      const installmentAmount = num('installmentAmount');
      const installmentsCount = num('installmentsCount');
      if (installmentAmount === undefined || !frequency) return null;
      if (r.installmentsCount !== undefined && installmentsCount === undefined) return null;
      return {
        definition: CreditDefinition.AGREED_INSTALLMENT,
        principal,
        installmentAmount,
        ...(installmentsCount !== undefined ? { installmentsCount } : {}),
        frequency,
        firstDueDate: date,
      };
    }
    case CreditDefinition.AGREED_TOTAL: {
      const agreedTotal = num('agreedTotal');
      const repayment = enumOf(RepaymentForm, r.repayment);
      const installmentsCount = num('installmentsCount');
      if (agreedTotal === undefined || !repayment) return null;
      if (r.installmentsCount !== undefined && installmentsCount === undefined) return null;
      if (r.frequency !== undefined && !frequency) return null;
      return {
        definition: CreditDefinition.AGREED_TOTAL,
        principal,
        agreedTotal,
        repayment,
        ...(installmentsCount !== undefined ? { installmentsCount } : {}),
        ...(frequency ? { frequency } : {}),
        firstDueDate: date,
      };
    }
    default:
      return null;
  }
}

function enumOf<T extends Record<string, string>>(e: T, v: unknown): T[keyof T] | undefined {
  return typeof v === 'string' && (Object.values(e) as string[]).includes(v) ? (v as T[keyof T]) : undefined;
}

// ── Adaptadores del contrato anterior ─────────────────────────────────────────

export interface LoanQuote {
  /** Cuota (§4.2). */
  installment: number;
  /** Total a cobrar. */
  total: number;
  /** Ganancia = total − capital (el "Interés" del panel). */
  profit: number;
}

/**
 * Panel en vivo del Modo B (§4.2), ahora sobre el motor: simple + cuota fija.
 *
 *   % por período:  cuota = capital/n + capital × i/100
 *   % total:        total = capital × (1 + i/100)        ·  cuota = total / n
 *
 * El total es Σ de las cuotas del plan, no `cuota × n`: cuando la división no es exacta la última
 * cuota absorbe el céntimo, y el total mostrado es el que realmente se cobra.
 *
 * Ejemplo del PDF: capital 1.000, 10% por período, 5 cuotas → cuota 300, total 1.500, ganancia 500.
 */
export function quoteLoan(params: {
  principal: number;
  interestPercent: number;
  installments: number;
  base?: InterestBase;
}): LoanQuote {
  const calc = calculateCredit({
    definition: CreditDefinition.CALCULATED,
    principal: params.principal,
    ratePercent: params.interestPercent,
    rateBase: params.base,
    interestType: InterestType.SIMPLE,
    amortization: AmortizationMethod.FIXED_INSTALLMENT,
    periods: params.installments,
    frequency: PaymentFrequency.MONTHLY,
    firstDueDate: '2000-01-01', // la cotización no mira fechas
  });
  const q = calc.quote;
  if (!q || q.total === null || q.profit === null) return { installment: 0, total: 0, profit: 0 };
  return { installment: q.installment, total: q.total, profit: q.profit };
}

/**
 * El mismo panel partiendo de una cuota ya fijada — Modo A, y Modo B después de que el usuario la
 * **redondea a mano** (§5.2). Es la cuota acordada del motor: total = cuota × n.
 */
export function quoteFromInstallment(principal: number, installment: number, installments: number): LoanQuote {
  const total = toUnits(toCents(installment) * installments);
  return { installment: toUnits(toCents(installment)), total, profit: toUnits(toCents(total) - toCents(principal)) };
}

// ── D14: la cuota que manda el cliente en un crédito calculado ────────────────

export type InstallmentCheck = 'match' | 'normalized' | 'mismatch';

/**
 * Compara la cuota que envió el cliente con la del motor (sólo crédito calculado, D14).
 * Igual → `match`; a ±`INSTALLMENT_TOLERANCE` → `normalized` (se guarda la del motor);
 * más lejos → `mismatch` (la API rechaza: no puede haber dos resultados para el mismo modo).
 */
export function checkClientInstallment(engineInstallment: number, sent: number | undefined): InstallmentCheck {
  if (sent === undefined) return 'match';
  const diff = Math.abs(toCents(engineInstallment) - toCents(sent));
  if (diff === 0) return 'match';
  return diff <= toCents(INSTALLMENT_TOLERANCE) ? 'normalized' : 'mismatch';
}

// ── D14: qué guarda la API cuando el alta trae condiciones ────────────────────

/** Lo que el cliente mandó además de `terms` (los campos sueltos del alta de siempre). */
export interface SentCreditFields {
  principalAmount: number;
  installmentAmount?: number;
  installmentsCount?: number;
  frequency?: PaymentFrequency;
  nextDueDate?: string;
  firstDueDate?: string;
  interestRate?: number;
  amortizationType?: string;
}

export type TermsResolutionError =
  /** El motor no puede calcular o guardar esto (`issues` dice por qué). */
  | { ok: false; code: 'TERMS_INVALID'; issues: CreditTermsIssueCode[] }
  /** Cuotas que varían (capital fijo): hasta guardar el cronograma real (Fase 6) no se pueden cobrar bien. */
  | { ok: false; code: 'TERMS_NOT_PERSISTABLE' }
  /** Un campo suelto contradice a las condiciones. */
  | { ok: false; code: 'TERMS_CONFLICT'; field: keyof SentCreditFields }
  /** La cuota enviada no es la del acuerdo / la del motor, ni por redondeo. */
  | { ok: false; code: 'INSTALLMENT_MISMATCH'; expected: number; sent: number };

export interface TermsResolution {
  ok: true;
  terms: CreditTerms;
  /** La cuota que se congela en `metadata.installmentAmount`. */
  installmentAmount: number;
  /** 0 = préstamo abierto (la convención de la columna). */
  installmentsCount: number;
  frequency: PaymentFrequency;
  /** YYYY-MM-DD: el primer vencimiento. */
  nextDueDate: string;
  /** Para la columna `interest_rate`, sólo informativa (D7): el % de un calculado, 0 si fue acordado. */
  interestRatePercent: number;
  /** `null` en el préstamo abierto. */
  totalToCollect: number | null;
  /** `true` si la cuota del cliente difería en un céntimo y se guardó la del motor. */
  normalized: boolean;
}

/**
 * D14 — **quién manda según el modo**, en una función pura (la API sólo la llama):
 *  · calculado      → manda el motor: la cuota del cliente se acepta a ±1 céntimo y se guarda la del motor;
 *  · cuota acordada → manda la cuota del usuario: la del cliente tiene que ser exactamente esa;
 *  · total acordado → manda el total del usuario: la cuota se deriva y rige como en el calculado.
 *
 * Los campos sueltos que el cliente mande igual (cuota, número, fecha, frecuencia, tasa) tienen que
 * coincidir con las condiciones: si no, no se elige uno — se rechaza. Nunca dos cifras para el mismo crédito.
 */
export function resolveCreditTerms(terms: CreditTerms, sent: SentCreditFields): TermsResolution | TermsResolutionError {
  const calc = calculateCredit(terms);
  if (!calc.ok || !calc.quote) {
    return { ok: false, code: 'TERMS_INVALID', issues: calc.issues.filter((i) => i.severity === 'error').map((i) => i.code) };
  }
  const q = calc.quote;
  if (q.installmentVaries) return { ok: false, code: 'TERMS_NOT_PERSISTABLE' };

  if (toCents(sent.principalAmount) !== toCents(terms.principal)) return conflict('principalAmount');

  // Siempre la del motor: en el acordado coincide con la del usuario, en el resto es la autoridad.
  const installmentAmount = q.installment;
  let normalized = false;
  if (sent.installmentAmount !== undefined) {
    if (terms.definition === CreditDefinition.AGREED_INSTALLMENT) {
      // El acuerdo es la cuota misma: no hay redondeo que absorber.
      if (toCents(sent.installmentAmount) !== toCents(q.installment)) {
        return { ok: false, code: 'INSTALLMENT_MISMATCH', expected: q.installment, sent: sent.installmentAmount };
      }
    } else {
      const check = checkClientInstallment(q.installment, sent.installmentAmount);
      if (check === 'mismatch') {
        return { ok: false, code: 'INSTALLMENT_MISMATCH', expected: q.installment, sent: sent.installmentAmount };
      }
      normalized = check === 'normalized';
    }
  }

  const installmentsCount = q.installmentsCount ?? 0;
  if (sent.installmentsCount !== undefined && sent.installmentsCount !== installmentsCount) return conflict('installmentsCount');

  // Pago único de un total acordado: no tiene frecuencia; se respeta la que haya mandado el cliente.
  const termsFrequency = 'frequency' in terms ? terms.frequency : undefined;
  if (termsFrequency && sent.frequency !== undefined && sent.frequency !== termsFrequency) return conflict('frequency');
  const frequency = termsFrequency ?? sent.frequency ?? PaymentFrequency.MONTHLY;

  if (sent.nextDueDate !== undefined && sent.nextDueDate.slice(0, 10) !== terms.firstDueDate) return conflict('nextDueDate');
  if (sent.firstDueDate !== undefined && sent.firstDueDate.slice(0, 10) !== terms.firstDueDate) return conflict('firstDueDate');
  if (sent.amortizationType !== undefined) return conflict('amortizationType'); // el método va en `terms`

  const interestRatePercent = terms.definition === CreditDefinition.CALCULATED ? terms.ratePercent : 0;
  if (sent.interestRate !== undefined && sent.interestRate !== interestRatePercent) return conflict('interestRate');

  return {
    ok: true,
    terms,
    installmentAmount,
    installmentsCount,
    frequency,
    nextDueDate: terms.firstDueDate,
    interestRatePercent,
    totalToCollect: q.total,
    normalized,
  };
}

function conflict(field: keyof SentCreditFields): TermsResolutionError {
  return { ok: false, code: 'TERMS_CONFLICT', field };
}

// ── Utilidades ────────────────────────────────────────────────────────────────

const toCents = (units: number): number => Math.round(units * 100);
const toUnits = (cents: number): number => cents / 100;
const err = (code: CreditTermsIssueCode): CreditTermsIssue => ({ code, severity: 'error' });

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function principalCents(v: number, issues: CreditTermsIssue[]): number | null {
  if (!isFiniteNumber(v) || toCents(v) < 1) {
    issues.push(err('PRINCIPAL_INVALID'));
    return null;
  }
  return toCents(v);
}

function periodsOf(v: number | undefined, issues: CreditTermsIssue[]): number | null {
  if (!isFiniteNumber(v) || !Number.isInteger(v) || v < 1 || v > MAX_CREDIT_PERIODS) {
    issues.push(err('PERIODS_INVALID'));
    return null;
  }
  return v;
}

/** YYYY-MM-DD estricto → medianoche UTC. `2026-02-30` no es una fecha. */
function parseIsoDate(s: string): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? d : null;
}
