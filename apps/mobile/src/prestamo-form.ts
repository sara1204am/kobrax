/**
 * Lógica pura del alta de préstamo (V2, §4.1/§4.2/§5.2). El panel Cuota/Total/Ganancia sale de `quoteLoan`
 * de shared (misma matemática que el PDF); la cuota se **congela** al guardar (D1/D2). Sin red, sin React.
 */
import { InterestBase, PaymentFrequency, quoteFromInstallment, quoteLoan, type LoanQuote } from '@kobrax/shared';
import type { NewCreditInput } from './credits.service';

export type LoanMode = 'A' | 'B';

export interface PrestamoForm {
  mode: LoanMode;
  principal: string;
  installment: string; // Modo A: tipeada · Modo B: calculada, editable para redondeo
  installmentEdited: boolean; // Modo B: el usuario la corrigió a mano → no la pisa el cálculo
  interestPercent: string; // Modo B
  base: InterestBase; // Modo B
  installmentsCount: string; // opcional en A (vacío = préstamo abierto)
  frequency: PaymentFrequency;
  nextDueDate: string; // ISO YYYY-MM-DD
  inProgress: boolean; // "ya está en curso" (§4.1)
  outstandingBalance: string;
  daysPastDue: string;
  notes: string;
}

export function initialPrestamo(todayIso: string): PrestamoForm {
  return {
    mode: 'A',
    principal: '',
    installment: '',
    installmentEdited: false,
    interestPercent: '',
    base: InterestBase.PER_PERIOD,
    installmentsCount: '',
    frequency: PaymentFrequency.MONTHLY,
    nextDueDate: todayIso,
    inProgress: false,
    outstandingBalance: '',
    daysPastDue: '',
    notes: '',
  };
}

const num = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Panel en vivo (§4.2). Modo A: cuota tipeada. Modo B: `quoteLoan`, salvo que el usuario la haya editado. */
export function quoteFor(s: PrestamoForm): LoanQuote {
  const principal = num(s.principal);
  const n = num(s.installmentsCount);
  if (s.mode === 'A') return quoteFromInstallment(principal, num(s.installment), n);
  if (s.installmentEdited) return quoteFromInstallment(principal, num(s.installment), n);
  return quoteLoan({ principal, interestPercent: num(s.interestPercent), installments: n, base: s.base });
}

/** La cuota que se muestra/congela: la tipeada en A o editada en B; si no, la calculada. */
export function currentInstallment(s: PrestamoForm): number {
  if (s.mode === 'A' || s.installmentEdited) return num(s.installment);
  return quoteFor(s).installment;
}

/** Advertencia NO bloqueante (§5.2, D3): con nº de cuotas, si el total a cobrar es menor que el capital. */
export function totalBelowCapital(s: PrestamoForm): boolean {
  const n = num(s.installmentsCount);
  if (n < 1) return false; // préstamo abierto no tiene "total"
  return quoteFor(s).total + 0.005 < num(s.principal);
}

export function canSubmitPrestamo(s: PrestamoForm): boolean {
  if (num(s.principal) <= 0) return false;
  if (currentInstallment(s) <= 0) return false;
  if (s.mode === 'B' && !s.installmentEdited) {
    const i = num(s.interestPercent);
    const max = s.base === InterestBase.TOTAL ? 500 : 100; // §5.2
    if (i < 0 || i > max) return false;
    if (num(s.installmentsCount) < 1) return false; // el cálculo necesita n
  }
  if (s.inProgress && num(s.outstandingBalance) <= 0) return false;
  return true;
}

/** Arma el payload; la cuota viaja congelada y `openCase` lo pone el servicio del móvil. */
export function buildPrestamoPayload(s: PrestamoForm, clientId: string): NewCreditInput {
  const n = num(s.installmentsCount);
  return {
    clientId,
    principalAmount: num(s.principal),
    installmentAmount: currentInstallment(s),
    frequency: s.frequency,
    nextDueDate: s.nextDueDate,
    installmentsCount: n >= 1 ? n : undefined, // vacío = préstamo abierto
    interestRate: s.mode === 'B' ? num(s.interestPercent) : undefined,
    outstandingBalance: s.inProgress ? num(s.outstandingBalance) : undefined,
    daysPastDue: s.inProgress ? num(s.daysPastDue) : undefined,
    notes: s.notes.trim() || undefined,
  };
}
