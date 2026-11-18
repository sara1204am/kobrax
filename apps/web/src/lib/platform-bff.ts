import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiCall, type ApiEnvelope } from './bff';

/**
 * Consola de PLATAFORMA (la persona de Kobrax, no una empresa). Sesión aparte de la del panel:
 *  - Cookie propia `k_platform`, httpOnly + SameSite=Strict, de la MISMA vida que el token de plataforma (15 min).
 *  - **Sin refresh**: al vencer hay que volver a entrar con la contraseña y el código del MFA. Un acceso de plataforma no se renueva solo.
 *  - Nunca comparte cookie con `k_access`: un token de empresa no abre la consola ni al revés.
 * El navegador no ve el token: todo pasa por los route handlers de `/api/plataforma/*`.
 */
export const PLATFORM_COOKIE = 'k_platform';
export const PLATFORM_MAX_AGE = 15 * 60;

const base = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

export function setPlatformCookie(res: NextResponse, token: string): void {
  res.cookies.set(PLATFORM_COOKIE, token, { ...base, maxAge: PLATFORM_MAX_AGE });
}

export function clearPlatformCookie(res: NextResponse): void {
  res.cookies.set(PLATFORM_COOKIE, '', { ...base, maxAge: 0 });
}

export function platformToken(): string | undefined {
  return cookies().get(PLATFORM_COOKIE)?.value;
}

/** Llama a la API con el token de plataforma. Sin cookie ⇒ 401 sin salir a la red. */
export async function platformCall<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const token = platformToken();
  if (!token) {
    return {
      status: 401,
      body: { data: null, error: { code: 'PLATFORM_NO_SESSION', message: 'Inicia sesión en la consola' }, meta: { timestamp: new Date().toISOString(), version: '1' } },
    };
  }
  return apiCall<T>(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } });
}
