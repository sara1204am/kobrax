/**
 * «Tiene otros créditos» (F14 · F2, H-7): cuando quien ve al cliente no ve todos sus créditos, la ficha avisa con SÓLO agregados:
 * cuántos son, cuánto suman y quiénes son los responsables. Nunca cuotas, mora, gestiones ni el detalle del crédito ajeno.
 */
export interface HiddenCredit {
  outstandingBalance: number;
  /** Responsable y asignados vigentes (temporal/apoyo) de ese crédito. */
  responsibleIds: string[];
}

export interface OtherCredits {
  count: number;
  totalOutstanding: number;
  responsibles: { userId: string; name: string }[];
}

/** Cantidad, saldo total y responsables (con su nombre) de los créditos que el actor no ve. `null` = no hay otros. */
export function summarizeOtherCredits(hidden: HiddenCredit[], names: ReadonlyMap<string, string>): OtherCredits | null {
  if (hidden.length === 0) return null;
  const ids = [...new Set(hidden.flatMap((h) => h.responsibleIds))];
  return {
    count: hidden.length,
    totalOutstanding: Math.round(hidden.reduce((sum, h) => sum + h.outstandingBalance, 0) * 100) / 100,
    responsibles: ids
      .map((userId) => ({ userId, name: names.get(userId) ?? 'Alguien del equipo' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  };
}
