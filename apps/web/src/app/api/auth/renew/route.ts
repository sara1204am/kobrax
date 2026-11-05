import { NextRequest, NextResponse } from 'next/server';
import { API_BASE, COOKIE, RENEWED_COOKIE, clearAuthCookies, setAuthCookies } from '@/lib/bff';

/**
 * F14 · F1 (H-2): renueva el par de tokens cuando la API contestó `AUTHZ_STALE` a una pantalla de servidor (que no puede escribir
 * cookies) y vuelve a la pantalla. Un destino sólo puede ser una ruta interna: nada de `//host` ni de esquemas.
 * Si la renovación falla, la sesión terminó de verdad → login.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const refresh = req.cookies.get(COOKIE.refresh)?.value;

  if (refresh) {
    try {
      const r = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-type': 'web' },
        body: JSON.stringify({ refreshToken: refresh }),
        cache: 'no-store',
      });
      if (r.ok) {
        const json = (await r.json()) as { data?: { accessToken?: string; refreshToken?: string } };
        const { accessToken, refreshToken } = json.data ?? {};
        if (accessToken && refreshToken) {
          const res = NextResponse.redirect(new URL(next, req.url));
          setAuthCookies(res, { accessToken, refreshToken });
          res.cookies.set(RENEWED_COOKIE, '1', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 20 });
          return res;
        }
      }
    } catch {
      // La API no contestó: se trata como sesión no renovable.
    }
  }
  const res = NextResponse.redirect(new URL('/login', req.url));
  clearAuthCookies(res);
  return res;
}

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard';
  return raw;
}
