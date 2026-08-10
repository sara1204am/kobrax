import { NextRequest, NextResponse } from 'next/server';

/**
 * Protege las rutas privadas y hace **refresh silencioso**: como la cookie de
 * access vive 15 min (maxAge), cuando expira el navegador la borra → aquí, si hay
 * refresh, se pide un par nuevo a la API y se re-setean las cookies. Si no hay
 * sesión válida → redirige a /login. El navegador nunca ve los tokens.
 */
const API_BASE = process.env.KOBRAX_API_URL ?? 'http://127.0.0.1:4010/api';
const ACCESS = 'k_access';
const REFRESH = 'k_refresh';
const isProd = process.env.NODE_ENV === 'production';
const cookieBase = { httpOnly: true, sameSite: 'strict' as const, secure: isProd, path: '/' };

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.cookies.get(ACCESS)?.value) return NextResponse.next();

  const refresh = req.cookies.get(REFRESH)?.value;
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
        if (json.data?.accessToken && json.data.refreshToken) {
          const res = NextResponse.next();
          res.cookies.set(ACCESS, json.data.accessToken, { ...cookieBase, maxAge: 15 * 60 });
          res.cookies.set(REFRESH, json.data.refreshToken, { ...cookieBase, maxAge: 7 * 24 * 60 * 60 });
          return res;
        }
      }
    } catch {
      // cae al redirect de abajo
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  const res = NextResponse.redirect(url);
  res.cookies.set(ACCESS, '', { ...cookieBase, maxAge: 0 });
  res.cookies.set(REFRESH, '', { ...cookieBase, maxAge: 0 });
  return res;
}

// ⚠️ Toda ruta privada nueva entra acá. Es el error más fácil de cometer y el más difícil de
// notar: la pantalla anda perfecto hasta que expira el access token, 15 minutos después.
export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*', '/cuenta/:path*', '/equipo/:path*'],
};
