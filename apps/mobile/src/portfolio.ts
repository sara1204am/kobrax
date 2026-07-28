/**
 * Lógica pura de la lista de cartera (V3, §5.3): agrupa los casos del cobrador por cliente, agrega la
 * deuda, deriva el estado peor-caso, ordena (mora desc → próxima fecha), y filtra por chip + búsqueda local.
 * Sin red y sin React → testeable sola. El estado deriva de `portfolioStatus` de shared (fuente única).
 */
import { PortfolioStatus, portfolioStatus } from '@kobrax/shared';
import type { CaseListItem } from './cases.service';
import { money, MONTHS } from './agenda-form';

export type PortfolioChip = 'all' | 'today' | 'overdue' | 'current' | 'paid';

/** Criterios de orden de la lista (S4). `mora` es el de siempre y sigue siendo el default. */
export type PortfolioSort = 'mora' | 'deuda' | 'nombre' | 'vencimiento';

export const PORTFOLIO_SORT_LABEL: Record<PortfolioSort, string> = {
  mora: 'Mora',
  deuda: 'Deuda mayor',
  nombre: 'Nombre A-Z',
  vencimiento: 'Próximo vencimiento',
};

export interface ClientPortfolio {
  clientId: string;
  name: string;
  zone?: string;
  /** Punto en el mapa (Rutas S2). Sin él, el cliente no se puede pintar — pero sigue en la cartera. */
  latitude?: number;
  longitude?: number;
  documentMasked?: string;
  currency: string;
  /** Deuda agregada de todos los créditos del cliente (§5.3, "cifra dominante"). */
  totalDebt: number;
  creditCount: number;
  /** Estado peor-caso entre los créditos (badge de la tarjeta). */
  status: PortfolioStatus;
  maxDaysPastDue: number;
  /** La próxima fecha de cobro más cercana entre los créditos con saldo. */
  nextDueDate?: string;
  /** "8 días de mora" | "Cuota Bs 300 · vence 15 jul" | "" (§5.3). */
  secondaryLine: string;
}

/** Severidad para elegir el peor estado del cliente: mora primero, pagado al final. */
const SEVERITY: Record<PortfolioStatus, number> = {
  [PortfolioStatus.OVERDUE]: 0,
  [PortfolioStatus.DUE_SOON]: 1,
  [PortfolioStatus.PROMISE]: 2,
  [PortfolioStatus.CURRENT]: 3,
  [PortfolioStatus.PAID]: 4,
};

/** `2026-07-15` → `15 jul` (se lee en UTC, como se guarda). */
function shortDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
}

/** Normaliza para búsqueda local: minúsculas y sin acentos. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // quita diacríticos combinados
}

function isSameUtcDay(iso: string | undefined, asOf: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getUTCFullYear() === asOf.getUTCFullYear() &&
    d.getUTCMonth() === asOf.getUTCMonth() &&
    d.getUTCDate() === asOf.getUTCDate()
  );
}

/** Agrupa los casos por cliente en tarjetas de cartera, ordenadas (mora desc → próxima fecha asc). */
export function groupPortfolio(cases: CaseListItem[], asOf: Date = new Date()): ClientPortfolio[] {
  const byClient = new Map<string, CaseListItem[]>();
  for (const c of cases) {
    const arr = byClient.get(c.clientId);
    if (arr) arr.push(c);
    else byClient.set(c.clientId, [c]);
  }

  const out: ClientPortfolio[] = [];
  for (const [clientId, group] of byClient) {
    const currency = group.find((c) => c.currency)?.currency ?? 'BOB';
    const totalDebt = group.reduce((s, c) => s + (c.amount ?? 0), 0);
    const maxDaysPastDue = group.reduce((m, c) => Math.max(m, c.daysPastDue ?? 0), 0);

    // Estado peor-caso: cada crédito calcula el suyo con la regla única de shared.
    let status = PortfolioStatus.PAID;
    for (const c of group) {
      const s = portfolioStatus(
        {
          outstandingBalance: c.amount ?? 0,
          daysPastDue: c.daysPastDue ?? 0,
          nextDueDate: c.nextDueDate ?? null,
          hasActivePromise: c.hasActivePromise,
        },
        asOf,
      );
      if (SEVERITY[s] < SEVERITY[status]) status = s;
    }

    // Próximo cobro: el crédito con saldo y fecha más cercana → alimenta la línea "Cuota … · vence …".
    const next = group
      .filter((c) => (c.amount ?? 0) > 0.005 && c.nextDueDate)
      .sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!))[0];

    let secondaryLine = '';
    if (maxDaysPastDue > 0) {
      secondaryLine = `${maxDaysPastDue} ${maxDaysPastDue === 1 ? 'día' : 'días'} de mora`;
    } else if (next) {
      const cuota = next.installmentAmount != null ? `Cuota ${money(next.installmentAmount, currency)} · ` : '';
      secondaryLine = `${cuota}vence ${shortDue(next.nextDueDate!)}`;
    }

    const first = group[0]!;
    out.push({
      clientId,
      name: first.clientName ?? 'Sin nombre',
      zone: first.zone,
      latitude: first.latitude,
      longitude: first.longitude,
      documentMasked: first.documentMasked,
      currency,
      totalDebt,
      creditCount: new Set(group.map((c) => c.creditId)).size,
      status,
      maxDaysPastDue,
      nextDueDate: next?.nextDueDate,
      secondaryLine,
    });
  }

  // Orden por defecto (§5.3): mora desc, luego próxima fecha asc (sin fecha al final).
  return sortPortfolio(out, 'mora');
}

/** Sin fecha va **al final**: "no sé cuándo vence" no es "vence primero". */
function byNextDue(a: ClientPortfolio, b: ClientPortfolio): number {
  if (a.nextDueDate && b.nextDueDate) return a.nextDueDate.localeCompare(b.nextDueDate);
  return a.nextDueDate ? -1 : b.nextDueDate ? 1 : 0;
}

/**
 * Ordena la cartera ya agrupada (S4). `mora` es exactamente el orden que la lista tuvo siempre —
 * está acá, y no suelto al final de `groupPortfolio`, para que elegir criterio sea cambiar un argumento.
 * Copia antes de ordenar: la lista agrupada se comparte con los contadores de los chips.
 */
export function sortPortfolio(list: ClientPortfolio[], sort: PortfolioSort = 'mora'): ClientPortfolio[] {
  const out = [...list];
  switch (sort) {
    case 'mora':
      return out.sort((a, b) => b.maxDaysPastDue - a.maxDaysPastDue || byNextDue(a, b));
    case 'deuda':
      return out.sort((a, b) => b.totalDebt - a.totalDebt);
    case 'nombre':
      return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    case 'vencimiento':
      return out.sort(byNextDue);
  }
}

/**
 * ¿La tarjeta pasa el chip activo? (§5.3: Todos · Hoy · En mora · Al día · Pagados).
 * Los chips filtran por las reglas CRUDAS del §5.3 (mora, vencimiento, saldo), no por el badge derivado:
 * "En mora" = days_past_due > 0, literal. El badge (color) es una preocupación aparte.
 */
export function matchesChip(p: ClientPortfolio, chip: PortfolioChip, asOf: Date = new Date()): boolean {
  const hasDebt = p.totalDebt > 0.005;
  switch (chip) {
    case 'all':
      // ponytail: el §5.3 archiva PAGADO de "Todos" a los 30 días; se difiere hasta tener `closedAt` en la lista.
      return true;
    case 'today':
      return isSameUtcDay(p.nextDueDate, asOf);
    case 'overdue':
      return p.maxDaysPastDue > 0;
    case 'current':
      // "Al día": tiene saldo y no está en mora (incluye por vencer y promesa).
      return hasDebt && p.maxDaysPastDue === 0;
    case 'paid':
      return !hasDebt;
  }
}

/**
 * Búsqueda local por nombre, documento (enmascarado) o **zona**, sin acentos ni mayúsculas (§5.3).
 * La zona entra en S4 porque el cobrador piensa la cartera por barrio tanto como por nombre.
 */
export function matchesSearch(p: ClientPortfolio, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  return (
    norm(p.name).includes(q) ||
    (p.documentMasked ? norm(p.documentMasked).includes(q) : false) ||
    (p.zone ? norm(p.zone).includes(q) : false)
  );
}

/** Aplica chip + búsqueda sobre la cartera ya agrupada. */
export function filterPortfolio(
  list: ClientPortfolio[],
  chip: PortfolioChip,
  query: string,
  asOf: Date = new Date(),
): ClientPortfolio[] {
  return list.filter((p) => matchesChip(p, chip, asOf) && matchesSearch(p, query));
}
