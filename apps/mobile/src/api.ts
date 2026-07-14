/** Cliente HTTP a la API Kobrax. El mobile llama directo (no hay BFF). */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:4010/api';

/** `meta` de la respuesta estándar `{data,meta,error}`; en listados trae la paginación. */
export interface ApiMeta {
  total?: number;
  page?: number;
  limit?: number;
  pages?: number;
}

export interface ApiResult<T> {
  status: number;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  /** Presente en listados paginados (los KPIs de campo leen `meta.total`). */
  meta?: ApiMeta;
}

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-client-type': 'mobile',
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = (await res.json().catch(() => ({ data: null, error: null }))) as {
      data: T | null;
      error: ApiResult<T>['error'];
      meta?: ApiMeta;
    };
    return { status: res.status, data: json.data, error: json.error, meta: json.meta };
  } catch {
    // Sin red: lo señalamos con status 0 para que el caller decida modo offline.
    return { status: 0, data: null, error: { code: 'NETWORK', message: 'Sin conexión' } };
  }
}
