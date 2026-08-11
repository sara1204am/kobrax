import { PortfolioStatus, portfolioStatus } from '@kobrax/shared';

/** Un cliente de la cartera tal como lo devuelve `GET /clients?view=portfolio`. */
export interface PortfolioRow {
  id: string;
  clientType: 'PERSON' | 'COMPANY';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  /** Enmascarado siempre: la lista nunca revela PII (el `reveal` es de la ficha). */
  nationalId: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  riskSegment?: string;
  totalDebt: number;
  maxDaysPastDue: number;
  creditCount: number;
}

/**
 * El color de la fila. **No reimplementa el semáforo**: llama a `portfolioStatus` de `shared`,
 * que es el mismo que pinta la tarjeta del teléfono. Mismo cliente, mismo color en los dos lados.
 *
 * No le pasa `nextDueDate` porque la lista no lo tiene: no es una columna —vive en
 * `credit.metadata` o sale del cronograma— así que no se puede agregar en SQL. Consecuencia:
 * **en la lista nunca aparece POR VENCER**; se ve en la ficha, donde cada crédito lo resuelve con
 * `creditView()`. Es deliberado.
 */
export function rowStatus(row: Pick<PortfolioRow, 'totalDebt' | 'maxDaysPastDue'>): PortfolioStatus {
  return portfolioStatus({ outstandingBalance: row.totalDebt, daysPastDue: row.maxDaysPastDue });
}

export const STATUS_TONE: Record<PortfolioStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  [PortfolioStatus.OVERDUE]: 'danger',
  [PortfolioStatus.DUE_SOON]: 'warning',
  [PortfolioStatus.PROMISE]: 'warning',
  [PortfolioStatus.CURRENT]: 'neutral',
  [PortfolioStatus.PAID]: 'success',
};

/**
 * ¿Este texto contiene lo que se buscó? Sin acentos y sin mayúsculas: «MARTINEZ» tiene que
 * encontrar a «Martínez», que es como lo carga media Bolivia.
 *
 * Sólo la usa `/equipo`, que filtra en memoria porque `GET /users` devuelve el equipo entero.
 * La cartera **no** la usa: ahí busca el servidor, que además puede mirar el documento cifrado.
 */
export function matchesText(haystack: string, query: string): boolean {
  const q = normalize(query.trim());
  return q ? normalize(haystack).includes(q) : true;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
