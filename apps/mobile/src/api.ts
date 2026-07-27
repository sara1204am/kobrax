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

/**
 * Techo de espera de una subida. Diez veces el de `apiFetch` a propósito: por acá viajan archivos
 * de hasta 15 MB por una conexión de campo, y cortar a los 15 s abortaría subidas que iban bien.
 */
const UPLOAD_TIMEOUT_MS = 60_000;

/** Marca que la subida la cortamos nosotros por tiempo, no que el `fetch` falló. */
export class UploadTimeout extends Error {}

/**
 * POST multipart con techo de espera. Lo comparten la subida de archivos de import y la de
 * evidencia: son la misma llamada, y sin techo una API muda deja el botón girando para siempre.
 * El 401 → refresh → reintento queda en cada caller, que es lo único que difiere.
 */
export async function postMultipart(path: string, form: FormData, token: string): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UPLOAD_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-client-type': 'mobile' },
      body: form,
      signal: abort.signal,
    });
  } catch (e) {
    throw abort.signal.aborted ? new UploadTimeout() : e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Por qué falló una subida.
 *
 * React Native dice `Network request failed` sólo cuando de verdad no hay red. Cualquier otra
 * excepción es otra cosa —típicamente un archivo que no se puede abrir, como uno de Drive que
 * quedó sin copia local— y meterla en el mismo balde manda al usuario a revisar el wifi cuando
 * el problema está en el archivo, que es lo único que él puede arreglar. El mensaje crudo se
 * muestra: es feo, pero es la única pista que hay.
 */
export function uploadFailure(e: unknown): { status: 'offline' } | { status: 'error'; message: string } {
  if (e instanceof UploadTimeout) return { status: 'offline' };
  const msg = e instanceof Error ? e.message : String(e);
  if (/network request failed/i.test(msg)) return { status: 'offline' };
  return { status: 'error', message: `No se pudo leer el archivo en el teléfono: ${msg}` };
}

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
