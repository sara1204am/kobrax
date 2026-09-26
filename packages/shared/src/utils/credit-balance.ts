/**
 * Saldo y progreso del crédito (F4/06 · D15).
 *
 * 🔴 **Dos saldos, dos conceptos, y no se mezclan:**
 *  · `outstandingBalance` (columna) = saldo TOTAL pendiente de cobro (capital + ganancia). Es lo que
 *    descuentan los pagos, y por eso una cuota completa se puede cobrar entera.
 *  · saldo de CAPITAL = cuánto del capital prestado falta devolver. Se deriva del plan de pagos
 *    (`CreditScheduleRow.principalBalance`); no vive en ninguna columna.
 */
import type { EffectiveBalanceBasis } from '../enums/credit.enum.js';
import { calculateCredit, quoteFromInstallment, type CreditTerms } from './credit-engine.js';

/**
 * El total por cobrar del crédito, **si se conoce**. Nunca se inventa (D9):
 *  · con cronograma → Σ de sus cuotas;
 *  · con condiciones guardadas (`terms`) → el total del motor (exacto, también en el francés);
 *  · con cuota y número de cuotas → cuota × n (la cuota acordada del motor);
 *  · préstamo abierto o sin cuota (típico del importado) → `null`.
 */
export function creditTotalToCollect(credit: {
  principalAmount: number;
  installmentAmount?: number | null;
  installmentsCount?: number | null;
  installments?: { amount: number }[] | null;
  terms?: CreditTerms | null;
}): number | null {
  const rows = credit.installments ?? [];
  if (rows.length > 0) return Math.round(rows.reduce((s, r) => s + r.amount * 100, 0)) / 100;
  if (credit.terms) return calculateCredit(credit.terms).quote?.total ?? null;
  const n = credit.installmentsCount ?? 0;
  const cuota = credit.installmentAmount ?? 0;
  if (n >= 1 && cuota > 0) return quoteFromInstallment(credit.principalAmount, cuota, n).total;
  return null;
}

/**
 * Porcentaje cobrado (0–100) para la barra de progreso, o `null` si no se puede decir sin inventar.
 *
 *  · base `total` → contra el total por cobrar; sin total conocido no hay barra.
 *  · base `principal` (préstamo abierto) → contra el capital, que es lo que representa su saldo.
 *  · `legacy` → como antes (contra el capital): su saldo nació = capital. Se corrige al migrar.
 */
export function paymentProgress(credit: {
  basis: EffectiveBalanceBasis;
  outstandingBalance: number;
  principalAmount: number;
  totalToCollect: number | null;
  /**
   * Lo pagado antes de registrarlo en Kobrax (D13). Se descuenta de la referencia: «Recuperado» mide
   * sólo lo cobrado en Kobrax, así un crédito cargado con 3 cuotas pagadas arranca en 0 %.
   */
  priorPaidAmount?: number;
}): number | null {
  const full = credit.basis === 'total' ? credit.totalToCollect : credit.principalAmount;
  const reference = full === null ? null : full - (credit.basis === 'total' ? (credit.priorPaidAmount ?? 0) : 0);
  if (reference === null || reference <= 0) return null;
  const pct = Math.round(((reference - credit.outstandingBalance) / reference) * 100);
  return Math.max(0, Math.min(100, pct));
}
