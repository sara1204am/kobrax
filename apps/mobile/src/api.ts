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

/**
 * Techo de espera de toda llamada. Sin esto, una API que acepta la conexión y no contesta deja el
 * `fetch` colgado para siempre: el arranque (`app/index.tsx` → `routeAfterAuth`) se queda esperando
 * y la app no pasa del splash — sin error, sin banner, sin salida. Con el techo, el fallo cae en el
 * mismo `catch` de siempre y el cobrador ve el modo offline, que es lo que corresponde.
 *
 * ponytail: un valor único para todo. Si algún día una llamada legítima tarda más (un reporte
 * pesado), se le pasa el suyo por `init` — no se sube el global.
 */
const TIMEOUT_MS = 15_000;

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-client-type': 'mobile',
    ...init.headers,
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: abort.signal,
    });
    const json = (await res.json().catch(() => ({ data: null, error: null }))) as {
      data: T | null;
      error: ApiResult<T>['error'];
      meta?: ApiMeta;
    };
    return { status: res.status, data: json.data, error: json.error, meta: json.meta };
  } catch {
    // Sin red, o la API no contestó a tiempo: status 0 para que el caller decida modo offline.
    return { status: 0, data: null, error: { code: 'NETWORK', message: 'Sin conexión' } };
  } finally {
    clearTimeout(timer);
  }
}
