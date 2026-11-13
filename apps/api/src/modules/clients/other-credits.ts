/**
 * «Tiene otros créditos» (F14 · F2, H-7): cuando quien ve al cliente no ve todos sus créditos, la ficha avisa con agregados (cuántos son,
 * cuánto suman, quiénes los llevan) y, desde el ajuste de la prueba manual, con una tarjeta por crédito ajeno: código, tipo, estado, saldo
 * y responsables. Nunca cuotas, mora, gestiones ni el detalle: esa tarjeta no navega y los endpoints del crédito siguen dando 404.
 */
export interface HiddenCredit {
  id?: string;
  code?: string | null;
  typeCode?: string | null;
  currency?: string | null;
  status?: string | null;
  outstandingBalance: number;
  /** Responsable y asignados vigentes (temporal/apoyo) de ese crédito. */
  responsibleIds: string[];
}

/** La tarjeta de un crédito ajeno: sólo para mostrar, nunca un enlace. */
export interface OtherCreditCard {
  code: string | null;
  typeCode: string | null;
  currency: string | null;
  status: string | null;
  outstandingBalance: number;
  responsibles: string[];
}

export interface OtherCredits {
  items: OtherCreditCard[];
  count: number;
  totalOutstanding: number;
  responsibles: { userId: string; name: string }[];
}

/** Cantidad, saldo total y responsables (con su nombre) de los créditos que el actor no ve. `null` = no hay otros. */
export function summarizeOtherCredits(hidden: HiddenCredit[], names: ReadonlyMap<string, string>): OtherCredits | null {
  if (hidden.length === 0) return null;
  const ids = [...new Set(hidden.flatMap((h) => h.responsibleIds))];
  return {
    items: hidden.map((h) => ({
      code: h.code ?? null,
      typeCode: h.typeCode ?? null,
      currency: h.currency ?? null,
      status: h.status ?? null,
      outstandingBalance: h.outstandingBalance,
      responsibles: h.responsibleIds.map((id) => names.get(id) ?? 'Alguien del equipo').sort((a, b) => a.localeCompare(b, 'es')),
    })),
    count: hidden.length,
    totalOutstanding: Math.round(hidden.reduce((sum, h) => sum + h.outstandingBalance, 0) * 100) / 100,
    responsibles: ids
      .map((userId) => ({ userId, name: names.get(userId) ?? 'Alguien del equipo' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  };
}
