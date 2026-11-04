import { memberName, type Member } from '@kobrax/shared';
import { matchesText } from './portfolio';
import type { OfficePortfolio } from './offices';
import { PAGE_SIZES } from './table-prefs';

/** Una fila de la tabla de equipo de una oficina: la persona y lo que tiene a su cargo. */
export interface OfficeTeamRow {
  userId: string;
  name: string;
  email: string;
  roleName: string;
  portfolio: OfficePortfolio;
}

/** Lo que la tabla sabe leer de la URL. Las claves son las que escribe el `DataTable` y el `SearchBox`. */
export interface OfficeTeamParams {
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

export const OFFICE_TEAM_PAGE_SIZE = 10;

/** Las columnas que esta tabla sabe ordenar. */
export const OFFICE_TEAM_SORTS = ['name', 'credits', 'arrearsCredits', 'balance', 'arrearsBalance'] as const;
type Sort = (typeof OFFICE_TEAM_SORTS)[number];

const EMPTY: OfficePortfolio = { credits: 0, arrearsCredits: 0, byCurrency: [] };

/** El equipo de la oficina con su cartera, listo para la tabla. */
export function officeTeamRows(members: Member[], portfolios: Record<string, OfficePortfolio>): OfficeTeamRow[] {
  return members.map((m) => ({
    userId: m.userId,
    name: memberName(m),
    email: m.email,
    roleName: m.roleName,
    portfolio: portfolios[m.userId] ?? EMPTY,
  }));
}

/**
 * Saldo de una persona para ordenar. Con dos monedas es la suma de los números (el orden es una pista, no una cuenta:
 * las cifras de cada moneda se muestran separadas).
 */
const total = (r: OfficeTeamRow, pick: 'balance' | 'arrearsBalance'): number => r.portfolio.byCurrency.reduce((n, c) => n + c[pick], 0);

const VALUE: Record<Exclude<Sort, 'name'>, (r: OfficeTeamRow) => number> = {
  credits: (r) => r.portfolio.credits,
  arrearsCredits: (r) => r.portfolio.arrearsCredits,
  balance: (r) => total(r, 'balance'),
  arrearsBalance: (r) => total(r, 'arrearsBalance'),
};

export function hasOfficeTeamSearch(params: OfficeTeamParams): boolean {
  return Boolean(params.q?.trim());
}

/**
 * Buscar, ordenar y paginar el equipo de una oficina **en memoria**: son pocas filas (el equipo de una oficina) y la API
 * ya las devolvió con su cartera. Sin filtros: sólo la búsqueda global, que mira nombre, correo y rol.
 *
 * Es pura, como `teamView` de Equipo: recibe lo de la API y lo de la URL, y devuelve la página y su `meta`.
 */
export function officeTeamView(
  rows: OfficeTeamRow[],
  params: OfficeTeamParams,
): { rows: OfficeTeamRow[]; meta: { total: number; page: number; limit: number; pages: number } } {
  const q = params.q?.trim() ?? '';
  let found = q ? rows.filter((r) => matchesText(r.name, q) || matchesText(r.email, q) || matchesText(r.roleName, q)) : rows;

  const sort = (OFFICE_TEAM_SORTS as readonly string[]).includes(params.sort ?? '') ? (params.sort as Sort) : 'name';
  const factor = params.dir === 'desc' ? -1 : 1;
  found = [...found].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) * factor : (VALUE[sort](a) - VALUE[sort](b)) * factor || a.name.localeCompare(b.name),
  );

  const limit = PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : OFFICE_TEAM_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(found.length / limit));
  // Buscar puede dejar menos páginas de las que había: quedarse en la 5 mostraría una tabla vacía con el pie diciendo que hay filas.
  const page = Math.min(Math.max(1, Number(params.page) || 1), pages);
  return { rows: found.slice((page - 1) * limit, page * limit), meta: { total: found.length, page, limit, pages } };
}
