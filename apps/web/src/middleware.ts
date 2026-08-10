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
          /*
           * Las cookies nuevas hay que ponerlas en DOS lados.
           *
           * `res.cookies.set` viaja al navegador, pero el handler o la página de **este mismo
           * request** leen `cookies()`, que son las que llegaron: sin reescribir el header,
           * este request sigue sin token y termina en 401 aunque el refresh haya salido bien.
           * Se notaba recién en los handlers del BFF, donde no hay una segunda navegación que
           * lo tape.
           */
          const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
          jar.set(ACCESS, json.data.accessToken);
          jar.set(REFRESH, json.data.refreshToken);
          const headers = new Headers(req.headers);
          headers.set(
            'cookie',
            [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
          );

          const res = NextResponse.next({ request: { headers } });
          res.cookies.set(ACCESS, json.data.accessToken, { ...cookieBase, maxAge: 15 * 60 });
          res.cookies.set(REFRESH, json.data.refreshToken, { ...cookieBase, maxAge: 7 * 24 * 60 * 60 });
          return res;
        }
      }
    } catch {
      // cae al redirect de abajo
    }
  }

  // A un handler del BFF no se le contesta con un redirect: quien llamó espera JSON y
  // recibiría el HTML del login con status 200, que su `res.json()` no sabe leer.
  const res = req.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: { code: 'AUTH_003', message: 'Sesión expirada' } }, { status: 401 })
    : NextResponse.redirect(new URL('/login', req.url));

  res.cookies.set(ACCESS, '', { ...cookieBase, maxAge: 0 });
  res.cookies.set(REFRESH, '', { ...cookieBase, maxAge: 0 });
  return res;
}

/**
 * ⚠️ Toda ruta privada nueva entra acá. Es el error más fácil de cometer y el más difícil de
 * notar: la pantalla anda perfecto hasta que expira el access token, 15 minutos después.
 *
 * Y **también los handlers del BFF que hablan con la API autenticados**. Sin ellos pasaba
 * esto: con la pestaña abierta más de 15 minutos sin navegar, la cookie de acceso ya no
 * existía, el handler llamaba sin `Authorization`, la API devolvía 401 y reintentar fallaba
 * para siempre —el camino que falla nunca refresca la cookie— aunque el refresh de 7 días
 * estuviera intacto.
 *
 * Los públicos (`/api/auth/login`, `registro`, `invitacion`, `forgot-password`…) **no** van:
 * ahí todavía no hay sesión y el middleware los cortaría antes de empezar.
 */
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/settings/:path*',
    '/cuenta/:path*',
    '/equipo/:path*',
    '/api/auth/me',
    '/api/auth/switch-account',
    '/api/account/:path*',
    '/api/users/:path*',
    '/api/uploads/:path*',
  ],
};
