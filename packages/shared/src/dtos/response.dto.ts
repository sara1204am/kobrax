import type { ErrorDto } from './error.dto.js';

export interface ResponseMeta {
  timestamp: string;
  version: string;
  total?: number;
  page?: number;
  limit?: number;
  pages?: number;
  /**
   * Sumas sobre TODO el filtro, no sobre la página (p. ej. `totalAmount` de los pagos). Una lista paginada
   * no puede sumar lo que no trajo: lo agrega el servidor.
   */
  aggregates?: Record<string, number>;
}

export interface ApiResponse<T> {
  data: T | null;
  error: ErrorDto | null;
  meta: ResponseMeta;
}

const VERSION = '1';

/** Helpers para construir el contrato de respuesta `{ data, meta, error }`. */
export const ResponseDto = {
  ok<T>(data: T, meta?: Partial<ResponseMeta>): ApiResponse<T> {
    return {
      data,
      error: null,
      meta: { timestamp: new Date().toISOString(), version: VERSION, ...meta },
    };
  },

  paginated<T>(data: T[], total: number, page: number, limit: number, aggregates?: Record<string, number>): ApiResponse<T[]> {
    return {
      data,
      error: null,
      meta: {
        timestamp: new Date().toISOString(),
        version: VERSION,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        ...(aggregates ? { aggregates } : {}),
      },
    };
  },

  error(code: string, message: string, details?: unknown): ApiResponse<null> {
    return {
      data: null,
      error: { code, message, details },
      meta: { timestamp: new Date().toISOString(), version: VERSION },
    };
  },
};
