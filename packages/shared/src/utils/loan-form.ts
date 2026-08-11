/**
 * Lógica pura del alta de préstamo: qué cuota se muestra, cuándo el alta es válida, y qué se manda.
 *
 * 🔴 **Es plata.** La matemática de abajo (`quoteLoan`, `quoteFromInstallment`) ya vivía acá; lo que
 * se promovió del móvil en F9 · W3 es la capa que decide *cuál* se usa y *cuándo*. Si el escritorio
 * cotizara distinto que el teléfono, la diferencia aparece meses después, en la boca de un cliente.
 *
 * La cuota se calcula una vez, se puede redondear a mano, y se **congela** al guardar.
 */
import { InterestBase, PaymentFrequency } from '../enums/credit.enum.js';
import type { NewCreditInput, PrestamoForm } from '../types/client.types.js';
import { quoteFromInstallment, quoteLoan, type LoanQuote } from './loan.js';

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

/** Panel en vivo. Modo A: cuota tipeada. Modo B: `quoteLoan`, salvo que el usuario la haya editado. */
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

/** Advertencia NO bloqueante: con nº de cuotas, si el total a cobrar es menor que el capital. */
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
    const max = s.base === InterestBase.TOTAL ? 500 : 100;
    if (i < 0 || i > max) return false;
    if (num(s.installmentsCount) < 1) return false; // el cálculo necesita n
  }
  if (s.inProgress && num(s.outstandingBalance) <= 0) return false;
  return true;
}

/**
 * Arma el payload; la cuota viaja congelada.
 *
 * `openCase` y `origin` los pone quien llama: el móvil siempre abre el caso, y la web también
 * (sin caso el crédito no le llega a nadie). `assignedManagerId` sólo lo manda la web, donde el
 * cobrador se elige en el formulario en vez de ser quien carga.
 */
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
