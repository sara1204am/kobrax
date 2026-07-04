/** Query de paginación estándar (offset-based). */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Normaliza page/limit aplicando defaults y tope máximo. */
export function resolvePagination(query: PaginationQuery): { page: number; limit: number; skip: number } {
  const page = Math.max(1, query.page ?? DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}
