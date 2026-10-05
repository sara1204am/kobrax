/**
 * Lógica pura de la lista de cartera (V3, §5.3): agrupa los créditos del cobrador (al día o en mora; filas de
 * `GET /mora?todos=true`) por cliente, agrega la deuda, deriva el estado peor-caso, ordena (mora desc → próxima fecha), y filtra por chip + búsqueda local.
 * Sin red y sin React → testeable sola. El estado deriva de `portfolioStatus` de shared (fuente única).
 */
import { PortfolioStatus, portfolioStatus, type MoraCreditListItem, type PortfolioLocation } from '@kobrax/shared';
import { money, MONTHS } from './agenda-form';

/** `psf`: sólo los clientes con algún crédito importado de una fuente externa (PSF). */
export type PortfolioChip = 'all' | 'today' | 'overdue' | 'current' | 'paid' | 'psf';

/**
 * Lo que `groupPortfolio` lee de cada crédito. Es un subconjunto de `MoraCreditListItem` (la fila de
 * `GET /mora`): mapeo desde el viejo `CaseListItem` → amount = balance, creditCode = code, assigneeId =
 * responsibleId, status = situation + writtenOff. `situation`, `writtenOff` y `category` son opcionales para
 * que una fila mínima también agrupe.
 */
export type PortfolioCredit = Pick<
  MoraCreditListItem,
  'creditId' | 'clientId' | 'currency' | 'daysPastDue' | 'hasActivePromise'
> &
  Partial<
    Pick<
      MoraCreditListItem,
      | 'clientName'
      | 'balance'
      | 'nextDueDate'
      | 'installmentAmount'
      | 'zone'
      | 'locations'
      | 'documentMasked'
      | 'externalSource'
      | 'syncStatus'
      | 'reportedAsOf'
      | 'reportedStale'
      | 'writtenOff'
      | 'category'
      | 'situation'
    >
  >;

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
  /**
   * Puntos en el mapa (Rutas S2): los del cliente y los de sus garantes/familiares. Vacío = no se
   * puede pintar, pero sigue en la cartera.
   */
  locations: PortfolioLocation[];
  documentMasked?: string;
  currency: string;
  /** Deuda agregada de todos los créditos del cliente (§5.3, "cifra dominante"). */
  totalDebt: number;
  creditCount: number;
  /** Estado del peor crédito (badge de la tarjeta). */
  status: PortfolioStatus;
  /** Todos sus créditos están castigados (condición aparte: el badge de la tarjeta dice «Castigado»). */
  writtenOff: boolean;
  /** Cuántos de sus créditos están castigados. */
  writtenOffCount: number;
  /** Categoría de mora (A/B/C…) del crédito con más días de mora; ausente = al día o sin categorías configuradas. */
  category?: string;
  /** Algún crédito es de una fuente externa (PSF): el chip «PSF». */
  external: boolean;
  maxDaysPastDue: number;
  /** La próxima fecha de cobro más cercana entre los créditos con saldo. */
  nextDueDate?: string;
  /** "8 días de mora" | "Cuota Bs 300 · vence 15 jul" | "" (§5.3). */
  secondaryLine: string;
  /**
   * D7: la fuente externa de sus créditos, cuando la hay — «PSF al 02/10», «PSF · ausente del
   * reporte». Ausente = todo es de Kobrax. La deuda de la tarjeta suma las dos; esto dice que parte
   * es un saldo reportado por el banco a su corte, no uno que lleve Kobrax.
   */
  sourceLine?: string;
}

/** `YYYY-MM-DD` → `dd/mm`. */
const ddmm = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * La línea de fuente de un cliente (D4, D7, D9): de qué fuente, a qué corte, y si alguna operación
 * ya no viene en el reporte o tiene el dato viejo — que cambian cómo se lee el monto de la tarjeta.
 */
export function sourceLineOf(group: Pick<PortfolioCredit, 'externalSource' | 'syncStatus' | 'reportedAsOf' | 'reportedStale'>[]): string | undefined {
  const external = group.filter((c) => c.externalSource);
  if (external.length === 0) return undefined;
  const sources = [...new Set(external.map((c) => c.externalSource!))].join(', ');
  if (external.some((c) => c.syncStatus === 'ABSENT')) return `${sources} · ausente del reporte`;
  if (external.some((c) => c.reportedStale)) return `${sources} · dato desactualizado`;
  const asOf = external.map((c) => c.reportedAsOf).filter(Boolean).sort()[0];
  return asOf ? `${sources} al ${ddmm(asOf)}` : sources;
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

/** Agrupa los créditos por cliente en tarjetas de cartera, ordenadas (mora desc → próxima fecha asc). */
export function groupPortfolio(credits: PortfolioCredit[], asOf: Date = new Date()): ClientPortfolio[] {
  const byClient = new Map<string, PortfolioCredit[]>();
  for (const c of credits) {
    const arr = byClient.get(c.clientId);
    if (arr) arr.push(c);
    else byClient.set(c.clientId, [c]);
  }

  const out: ClientPortfolio[] = [];
  for (const [clientId, group] of byClient) {
    const currency = group.find((c) => c.currency)?.currency ?? 'BOB';
    const totalDebt = group.reduce((s, c) => s + (c.balance ?? 0), 0);
    const maxDaysPastDue = group.reduce((m, c) => Math.max(m, c.daysPastDue ?? 0), 0);

    // Estado del peor crédito: cada uno calcula el suyo con la regla única de shared.
    let status = PortfolioStatus.PAID;
    for (const c of group) {
      const s = portfolioStatus(
        {
          outstandingBalance: c.balance ?? 0,
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
      .filter((c) => (c.balance ?? 0) > 0.005 && c.nextDueDate)
      .sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!))[0];

    const writtenOffCount = group.filter((c) => c.writtenOff).length;
    // La categoría que se muestra es la del crédito más atrasado: es la que dice qué tan grave es el cliente.
    const worst = [...group].sort((a, b) => (b.daysPastDue ?? 0) - (a.daysPastDue ?? 0))[0];
    const category = (worst?.daysPastDue ?? 0) > 0 ? worst?.category?.code : undefined;

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
      // Las ubicaciones vienen iguales en todos los créditos del cliente (son del cliente, no del crédito).
      locations: first.locations ?? [],
      documentMasked: first.documentMasked,
      currency,
      totalDebt,
      creditCount: new Set(group.map((c) => c.creditId)).size,
      status,
      writtenOff: writtenOffCount === group.length,
      writtenOffCount,
      category,
      external: group.some((c) => !!c.externalSource),
      maxDaysPastDue,
      nextDueDate: next?.nextDueDate,
      secondaryLine,
      sourceLine: sourceLineOf(group),
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
 * ¿La tarjeta pasa el chip activo? (§5.3: Todos · Hoy · En mora · Al día · Pagados · PSF).
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
    case 'psf':
      return p.external;
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
