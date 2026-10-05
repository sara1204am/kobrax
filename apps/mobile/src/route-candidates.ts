/**
 * Candidatas a parada del planificador de rutas (F4/08): **una por crédito**, sacadas de `GET /mora`.
 * Un cliente con dos créditos en mora aporta dos candidatas (dos paradas posibles, cada una cobra su crédito).
 * Puro y sin React: se prueba solo.
 */
import { PortfolioStatus } from '@kobrax/shared';
import type { MoraCreditListItem, PortfolioLocation } from '@kobrax/shared';

export interface RouteCandidate {
  creditId: string;
  clientId: string;
  /** Nombre del deudor (más el nº de crédito cuando el cliente tiene más de uno en la lista). */
  name: string;
  zone?: string;
  /** Puntos dibujables: los del cliente y los de sus garantes/familiares. Vacío = no se pinta. */
  locations: PortfolioLocation[];
  currency: string;
  /** Saldo del crédito (0 si el archivo importado no lo trajo). */
  balance: number;
  daysPastDue: number;
  status: PortfolioStatus;
  /** "8 días de mora" | "Al día" */
  secondaryLine: string;
}

export function toRouteCandidates(rows: MoraCreditListItem[]): RouteCandidate[] {
  const perClient = new Map<string, number>();
  for (const r of rows) perClient.set(r.clientId, (perClient.get(r.clientId) ?? 0) + 1);
  return rows.map((r) => {
    const base = r.clientName ?? 'Cliente';
    const multiple = (perClient.get(r.clientId) ?? 0) > 1;
    return {
      creditId: r.creditId,
      clientId: r.clientId,
      name: multiple && r.code ? `${base} · ${r.code}` : base,
      zone: r.zone,
      locations: r.locations ?? [],
      currency: r.currency,
      balance: r.balance ?? 0,
      daysPastDue: r.daysPastDue,
      status: r.daysPastDue > 0 ? PortfolioStatus.OVERDUE : PortfolioStatus.CURRENT,
      secondaryLine: r.daysPastDue > 0 ? `${r.daysPastDue} ${r.daysPastDue === 1 ? 'día' : 'días'} de mora` : 'Al día',
    };
  });
}
