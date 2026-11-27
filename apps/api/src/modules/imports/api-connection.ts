/**
 * Cómo se guarda la conexión con la API (`account.configuration.importApi`). Las cabeceras y el cuerpo
 * van cifrados juntos: ahí vive la clave. Función pura, con el cifrado inyectado.
 */
import type { ImportApiConnection, ImportApiConnectionInput } from '@kobrax/shared';
import { ApiSourceError, checkApiBody, checkApiHeaders, checkApiUrl, type ApiRequest } from './api-source';

export interface StoredApiConnection {
  method: 'GET' | 'POST';
  url: string;
  headerNames: string[];
  hasBody: boolean;
  /** `{ headers, body }` cifrado. */
  secret: string;
}

interface Cipher {
  encrypt(plain: string): string;
  decrypt(payload: string): string;
}

interface Secret {
  headers: Record<string, string>;
  body?: string;
}

export function readApiConnection(configuration: unknown): StoredApiConnection | null {
  const raw = (configuration as { importApi?: StoredApiConnection } | null)?.importApi;
  return raw?.url && raw.secret ? raw : null;
}

export function apiConnectionView(stored: StoredApiConnection | null): ImportApiConnection | null {
  if (!stored) return null;
  const { method, url, headerNames, hasBody } = stored;
  return { method, url, headerNames, hasBody };
}

export function buildApiConnection(
  input: ImportApiConnectionInput,
  prev: StoredApiConnection | null,
  cipher: Cipher,
  allowLocal: boolean,
): StoredApiConnection {
  if (input?.method !== 'GET' && input?.method !== 'POST') throw new ApiSourceError('IMPORT_API_METHOD', 'El método es GET o POST');
  if (typeof input.url !== 'string' || input.url.length > 2000) throw new ApiSourceError('IMPORT_API_URL', 'Falta la dirección');
  const url = checkApiUrl(input.url.trim(), allowLocal);
  if (!Array.isArray(input.headers) || (input.body !== undefined && typeof input.body !== 'string')) {
    throw new ApiSourceError('IMPORT_API_HEADER', 'Las cabeceras no son válidas');
  }

  // 🔴 Lo guardado sólo se reusa contra el MISMO servidor: si no, cambiar la dirección mandaría la
  // clave del banco a cualquier otro sitio.
  const sameServer = prev !== null && new URL(prev.url).origin === url.origin;
  const old: Secret = sameServer ? (JSON.parse(cipher.decrypt(prev.secret)) as Secret) : { headers: {} };
  const missing = (): ApiSourceError =>
    new ApiSourceError('IMPORT_API_SECRET', 'Escribí de nuevo los valores: la dirección apunta a otro servidor o son nuevos');

  const headers: Record<string, string> = {};
  for (const entry of input.headers) {
    const name = String(entry?.name ?? '').trim();
    if (!name) continue;
    const value = typeof entry.value === 'string' && entry.value !== '' ? entry.value : old.headers[name];
    if (value === undefined) throw missing();
    headers[name] = value;
  }
  if (input.body === undefined && prev?.hasBody && !sameServer && input.method === 'POST') throw missing();
  const body = input.method === 'POST' ? (input.body ?? old.body) || undefined : undefined;
  checkApiHeaders(headers);
  checkApiBody(body);

  return {
    method: input.method,
    url: url.toString(),
    headerNames: Object.keys(headers),
    hasBody: body !== undefined,
    secret: cipher.encrypt(JSON.stringify({ headers, body } satisfies Secret)),
  };
}

export function toApiRequest(stored: StoredApiConnection, cipher: Cipher): ApiRequest {
  const { headers, body } = JSON.parse(cipher.decrypt(stored.secret)) as Secret;
  return { method: stored.method, url: stored.url, headers, body };
}
