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

/** Pantallas de acceso: con la sesión abierta no se muestran, se va al panel (W-LOG-54). */
const GUEST_ONLY = new Set(['/login', '/registro', '/forgot-password', '/invitacion']);

/**
 * /login, /registro, /forgot-password e /invitacion con una sesión **válida** van al dashboard.
 *
 * Se comprueba contra la API y no solo con que exista la cookie: una sesión revocada en el servidor
 * dejaría la cookie puesta, y redirigir igual haría un bucle (el panel la manda de vuelta a /login).
 * Sesión vencida, rechazada o API caída → se muestra el formulario, como siempre.
 * `/reset-password` no pasa por acá: el enlace del correo tiene que seguir funcionando.
 */
async function guestOnly(req: NextRequest): Promise<NextResponse> {
  const access = req.cookies.get(ACCESS)?.value;
  if (access) {
    try {
      const me = await fetch(`${API_BASE}/auth/me`, {
        headers: { authorization: `Bearer ${access}`, 'x-client-type': 'web' },
        cache: 'no-store',
      });
      if (me.ok) return NextResponse.redirect(new URL('/dashboard', req.url));
    } catch {
      return NextResponse.next(); // API caída: no se adivina, se muestra el formulario
    }
  }

  const refresh = req.cookies.get(REFRESH)?.value;
  if (!refresh) return NextResponse.next();
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
        const res = NextResponse.redirect(new URL('/dashboard', req.url));
        res.cookies.set(ACCESS, json.data.accessToken, { ...cookieBase, maxAge: 15 * 60 });
        res.cookies.set(REFRESH, json.data.refreshToken, { ...cookieBase, maxAge: 7 * 24 * 60 * 60 });
        return res;
      }
    }
    const res = NextResponse.next();
    if (r.status === 401 || r.status === 403) {
      // Sesión muerta de verdad: se limpian las cookies para no repetir la pregunta.
      res.cookies.set(ACCESS, '', { ...cookieBase, maxAge: 0 });
      res.cookies.set(REFRESH, '', { ...cookieBase, maxAge: 0 });
    }
    return res;
  } catch {
    return NextResponse.next();
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (GUEST_ONLY.has(req.nextUrl.pathname)) return guestOnly(req);
  if (req.cookies.get(ACCESS)?.value) return NextResponse.next();

  const refresh = req.cookies.get(REFRESH)?.value;
  /** El servidor dijo que ese refresh ya no vale. Distinto de «no pude preguntarle». */
  let rejected = false;

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
      // 401/403 = el refresh está muerto de verdad (vencido, revocado, reusado).
      rejected = r.status === 401 || r.status === 403;
    } catch {
      /*
       * La API no contestó. **No se toca la sesión**: un reinicio de dos segundos o un
       * parpadeo de red destruía un refresh de 7 días perfectamente válido y mandaba a
       * escribir contraseña y MFA de nuevo. Se responde que no y se reintenta en el próximo
       * request, que es cuando la API ya volvió.
       */
    }
  }

  // A un handler del BFF no se le contesta con un redirect: quien llamó espera JSON y
  // recibiría el HTML del login con status 200, que su `res.json()` no sabe leer.
  const res = req.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: { code: 'AUTH_003', message: 'Sesión expirada' } }, { status: 401 })
    : NextResponse.redirect(new URL('/login', req.url));

  /*
   * Las cookies se borran SÓLO si el servidor rechazó el refresh.
   *
   * Borrarlas siempre tenía dos víctimas: el parpadeo de red de arriba, y —peor— cualquier
   * página ajena que pusiera un `<img src="https://panel/api/uploads/x">`. Con `SameSite=Strict`
   * ese request llega sin cookies, así que el middleware no ve sesión… y en la respuesta
   * mandaba borrar las que el navegador sí tiene: un cierre de sesión a control remoto.
   */
  if (rejected) {
    res.cookies.set(ACCESS, '', { ...cookieBase, maxAge: 0 });
    res.cookies.set(REFRESH, '', { ...cookieBase, maxAge: 0 });
  }
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
    // Pantallas de acceso (solo para quien NO tiene sesión). Exactas: /login/mfa* no entran.
    '/login',
    '/registro',
    '/forgot-password',
    '/invitacion',
    '/dashboard/:path*',
    '/settings/:path*',
    '/cuenta/:path*',
    '/equipo/:path*',
    '/cartera/:path*',
    '/import/:path*',
    '/mora/:path*',
    '/agenda/:path*',
    '/rutas/:path*',
    '/pagos/:path*',
    '/exportar/:path*',
    '/api/auth/me',
    '/api/exports/:path*',
    '/api/notifications/:path*',
    '/api/auth/switch-account',
    '/api/account/:path*',
    '/api/users/:path*',
    '/api/clients/:path*',
    '/api/routes/:path*',
    '/api/credits/:path*',
    '/api/imports/:path*',
    '/api/assignments/:path*',
    '/api/arrear-categories/:path*',
    '/api/mora/:path*',
    '/api/agenda/:path*',
    '/api/dashboards/:path*',
    '/api/payments/:path*',
    '/api/payment-requests/:path*',
    '/api/uploads/:path*',
  ],
};
