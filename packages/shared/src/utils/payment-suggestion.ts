/**
 * El monto con que el formulario de pago **arranca lleno** (§5 de la revisión final: el cobrador en la
 * calle no tiene que tipear lo que el sistema ya sabe). Es una sugerencia: se puede cambiar.
 *
 * Una sola regla para la web y el móvil, así los dos proponen lo mismo para el mismo crédito.
 *
 *  · **Crédito de Kobrax**: lo que falta de la cuota impaga más antigua (con cronograma), o la cuota
 *    congelada (sin cronograma). Nunca más que el saldo.
 *  · **Operación externa (PSF)**: el monto en mora reportado; si el reporte no lo trae, la cuota
 *    reportada. **Nunca el saldo**: el saldo del reporte es la deuda entera, no lo que se va a cobrar hoy.
 *
 * `undefined` = no hay un monto sensato que proponer; el formulario arranca vacío.
 */
export interface PaymentSuggestionInput {
  /** Operación de una fuente externa (`creditView().locked`). */
  external: boolean;
  outstandingBalance: number;
  /** La cuota: congelada (Kobrax sin cronograma) o reportada (PSF). */
  installmentAmount?: number;
  /** Sólo PSF: el monto en mora que trajo el reporte. */
  reportedPastDueAmount?: number;
  /** El cronograma, si lo hay (sólo Kobrax). */
  installments?: readonly { number: number; amount: number; paidAmount?: number; status: string }[] | null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const positive = (x: number | undefined): number | undefined => (x !== undefined && Number.isFinite(x) && x > 0.005 ? round2(x) : undefined);

export function suggestedPaymentAmount(c: PaymentSuggestionInput): number | undefined {
  if (c.external) return positive(c.reportedPastDueAmount) ?? positive(c.installmentAmount);

  const pending = (c.installments ?? []).filter((i) => i.status !== 'PAID').sort((a, b) => a.number - b.number);
  const next = pending[0];
  const due = next ? next.amount - (next.paidAmount ?? 0) : c.installmentAmount;
  const amount = positive(due);
  return amount === undefined ? undefined : positive(Math.min(amount, c.outstandingBalance));
}
