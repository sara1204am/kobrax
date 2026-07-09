/**
 * Cliente HTTP autenticado: Bearer desde SecureStore + refresh 401→retry (una vez).
 * Es la base que consumen los `*.service.ts` de campo (P1–P5) y el `authService`:
 * nadie reimplementa el baile de auth. Dep unidireccional (api-client → api/session),
 * sin ciclo: `authService` importa de acá, no al revés.
 */
import type { AuthTokens } from '@kobrax/shared';
import { apiFetch, type ApiResult } from './api';
import { clearSession, getSession, saveSession } from './session';

export type AuthedFetchResult<T> = ApiResult<T> | { status: 'unauthenticated'; data: null; error: null };

/**
 * Refresh silencioso (rotatorio). Devuelve los nuevos tokens o null si falló.
 * Solo limpia la sesión si el server la rechazó (≠ fallo de red, status 0).
 *
 * **Single-flight:** varios 401 concurrentes comparten UN solo `/auth/refresh`. Sin esto,
 * el segundo llega con el refresh token ya rotado → el server lo rechaza como reuso →
 * `clearSession` → logout espurio a mitad de sesión (crítico: es la base de P1–P5).
 */
let refreshInFlight: Promise<AuthTokens | null> | null = null;

export function refreshSession(): Promise<AuthTokens | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<AuthTokens | null> {
  const session = await getSession();
  if (!session) return null;
  const res = await apiFetch<AuthTokens>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: session.refreshToken },
  });
  if (res.status !== 200 || !res.data) {
    if (res.status !== 0) await clearSession();
    return null;
  }
  await saveSession(res.data);
  return res.data;
}

/**
 * Hace la petición con el access token actual; ante 401 refresca y reintenta una vez.
 * - Sin sesión local → `status: 'unauthenticated'` (el caller manda a login).
 * - Sin red → `status: 0` (lo propaga `apiFetch`; el caller decide modo offline).
 * - Refresh rechazado por el server → devuelve el 401 (la sesión ya quedó limpia).
 */
export async function authedFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<AuthedFetchResult<T>> {
  const session = await getSession();
  if (!session) return { status: 'unauthenticated', data: null, error: null };

  let res = await apiFetch<T>(path, { ...init, token: session.accessToken });
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) return res;
    res = await apiFetch<T>(path, { ...init, token: refreshed.accessToken });
    // Refresh OK pero el server sigue con 401 → sesión revocada (no fue red): limpiar,
    // así el caller cae en 'unauthenticated' (login) en vez de quedar atrapado en offline.
    if (res.status === 401) await clearSession();
  }
  return res;
}

/**
 * Resultado normalizado de una lectura GET para las pantallas de campo. Distingue los
 * 4 estados que la UI debe mostrar distinto: dato / offline (banner, no bloquea) /
 * re-login / error. `total` viene de `meta.total` (KPIs de conteo) o del largo del array.
 */
export type QueryResult<T> =
  | { status: 'ok'; data: T; total: number }
  | { status: 'offline' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

/** GET autenticado + mapeo a `QueryResult`. Base de los `*.service.ts` (P1–P5): nadie repite este switch. */
export async function apiQuery<T>(path: string): Promise<QueryResult<T>> {
  const res = await authedFetch<T>(path);
  if (res.status === 'unauthenticated') return { status: 'unauthenticated' };
  if (res.status === 0) return { status: 'offline' };
  if (res.status === 200 && res.data !== null) {
    const total = res.meta?.total ?? (Array.isArray(res.data) ? res.data.length : 0);
    return { status: 'ok', data: res.data, total };
  }
  if (res.status === 401) return { status: 'unauthenticated' };
  return { status: 'error', message: res.error?.message ?? 'Ocurrió un error' };
}

/**
 * Resultado de una escritura (POST/PATCH/DELETE). Hermano de `QueryResult`: mismos 4 estados,
 * pero `offline` acá significa "no se guardó, reintentá" (la cola real de escritura llega en P6).
 */
export type MutateResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'offline' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

/** Escritura autenticada + mapeo a `MutateResult`. El `message` del server (AGENDA_00x) se propaga tal cual. */
export async function apiMutate<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<MutateResult<T>> {
  const res = await authedFetch<T>(path, { method, body });
  if (res.status === 'unauthenticated' || res.status === 401) return { status: 'unauthenticated' };
  if (res.status === 0) return { status: 'offline' };
  if ((res.status === 200 || res.status === 201) && res.data !== null) return { status: 'ok', data: res.data };
  return { status: 'error', message: res.error?.message ?? 'No se pudo guardar' };
}

/** Serializa params a query string, saltando `undefined`/`null`/`''`. */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
