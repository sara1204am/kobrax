/**
 * El aviso «este cliente tiene créditos que no ves» de la ficha (F14 · F2, H-7), con SOLO agregados: cuántos, por cuánto saldo y a cargo de quién.
 * Nunca el detalle de esos créditos. `null` = no hay nada que avisar (ve todos, o no hay otros).
 */
import type { OtherCreditsSummary } from '@kobrax/shared';

export function otherCreditsNotice(summary: OtherCreditsSummary | null | undefined, formatMoney: (n: number) => string): string | null {
  if (!summary || summary.count <= 0) return null;
  const names = summary.responsibles.map((p) => p.name).join(', ') || 'sin responsable';
  const cuantos = summary.count === 1 ? 'Este cliente tiene 1 crédito más' : `Este cliente tiene ${summary.count} créditos más`;
  return `${cuantos} que no ves, por un saldo de ${formatMoney(summary.totalOutstanding)}. A cargo de: ${names}.`;
}
