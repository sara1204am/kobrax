import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

/**
 * Capa BFF: el navegador nunca ve los tokens. Estas utilidades viven SOLO en el
 * servidor (route handlers / middleware / server components) y hablan con la API.
 */
export const API_BASE = process.env.KOBRAX_API_URL ?? 'http://127.0.0.1:4010/api';

export const COOKIE = {
  access: 'k_access',
  refresh: 'k_refresh',
  preAuth: 'k_preauth',
} as const;

const isProd = process.env.NODE_ENV === 'production';

const base = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: isProd,
  path: '/',
};

const ACCESS_MAX_AGE = 15 * 60; // 15 min (alineado con el access JWT)
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 días
const PREAUTH_MAX_AGE = 5 * 60; // 5 min (token intermedio entre pasos)

/** Respuesta del backend envuelta en `{ data, error, meta }`. */
export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta: { timestamp: string; version: string; total?: number; page?: number; limit?: number; pages?: number };
}

/** Llama a la API. `auth` adjunta el access token (cookie) como Bearer. */
export async function apiCall<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('x-client-type', 'web');
  if (init.auth) {
    const access = cookies().get(COOKIE.access)?.value;
    if (access) headers.set('authorization', `Bearer ${access}`);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    /*
     * La API no contesta (caída, DNS, `KOBRAX_API_URL` mal puesta). Se devuelve como estado y
     * no como excepción: un `throw` acá sube hasta el layout del panel, y **un layout que
     * revienta no lo atrapa su propio `error.tsx`** — dejaba la pantalla en blanco de Next,
     * sin shell y sin forma de volver. `status: 0` = ni siquiera hubo respuesta.
     */
    return {
      status: 0,
      body: {
        data: null,
        error: { code: 'API_UNREACHABLE', message: 'No pudimos conectar con el servidor' },
        meta: { timestamp: new Date().toISOString(), version: '1' },
      },
    };
  }
  const body = (await res.json().catch(() => ({ data: null, error: null, meta: {} }))) as ApiEnvelope<T>;
  return { status: res.status, body };
}

/**
 * Los headers de autenticación sueltos, para lo que **no es JSON**: subir un archivo
 * (`FormData`, cuyo `content-type` lo pone el navegador con su boundary) y descargarlo
 * (binario, que no pasa por `res.json()`). `apiCall` no sirve para esos dos casos.
 */
export function bearerHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'x-client-type': 'web' };
  const access = cookies().get(COOKIE.access)?.value;
  if (access) headers.authorization = `Bearer ${access}`;
  return headers;
}

// ── Cookies (se setean sobre la NextResponse del route handler/middleware) ─────
export function setAuthCookies(
  res: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookies.set(COOKIE.access, tokens.accessToken, { ...base, maxAge: ACCESS_MAX_AGE });
  res.cookies.set(COOKIE.refresh, tokens.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE });
  res.cookies.set(COOKIE.preAuth, '', { ...base, maxAge: 0 }); // limpia el intermedio
}

export function setPreAuthCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE.preAuth, token, { ...base, maxAge: PREAUTH_MAX_AGE });
}

export function clearAuthCookies(res: NextResponse): void {
  for (const name of Object.values(COOKIE)) res.cookies.set(name, '', { ...base, maxAge: 0 });
}

/**
 * CSRF: las rutas mutantes solo se aceptan desde el mismo origen (defensa adicional
 * a `SameSite=Strict`). Devuelve true si el Origin coincide con el host.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // navegación same-site sin Origin (GET); los POST del fetch lo envían
  const host = req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
