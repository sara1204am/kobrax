// @vitest-environment node
import { afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from './middleware';

/**
 * La cookie de acceso dura 15 minutos y sólo el middleware la renueva. Un handler `/api/...` que llama a la API
 * con el Bearer y no está en el `matcher` empieza a fallar con 401 pasado ese tiempo, y reintentar nunca lo
 * arregla. Fue lo que pasaba con «Exportar» de Mora: «No se pudo exportar» para siempre.
 */
describe('middleware · rutas que renuevan la sesión', () => {
  it.each(['/api/mora/:path*', '/api/assignments/:path*', '/api/arrear-categories/:path*', '/mora/:path*'])('cubre %s', (route) => {
    expect(config.matcher).toContain(route);
  });
});

describe('middleware · pantallas de acceso con sesión abierta (W-LOG-54)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const req = (path: string, cookies: Record<string, string> = {}) =>
    new NextRequest(`http://localhost:3000${path}`, {
      headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
  const location = (res: Response) => res.headers.get('location');
  const json = (status: number, body: unknown = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it.each(['/login', '/registro', '/forgot-password', '/invitacion'])('el matcher cubre %s exacto', (route) => {
    expect(config.matcher).toContain(route);
  });

  it('/reset-password y los pasos /login/mfa* no están en el matcher', () => {
    expect(config.matcher).not.toContain('/reset-password');
    expect(config.matcher.some((m) => m.startsWith('/login/'))).toBe(false);
  });

  it.each(['/login', '/registro', '/forgot-password', '/invitacion'])(
    '%s con access válido redirige al dashboard',
    async (path) => {
      vi.stubGlobal('fetch', vi.fn(() => json(200, { data: {} })));
      const res = await middleware(req(path, { k_access: 'a' }));
      expect(location(res)).toBe('http://localhost:3000/dashboard');
    },
  );

  it('sin cookies muestra el formulario y no llama a la API', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await middleware(req('/login'));
    expect(location(res)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('cookie de acceso revocada en el servidor (401) y sin refresh: muestra el formulario, sin bucle', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(401)));
    const res = await middleware(req('/login', { k_access: 'a' }));
    expect(location(res)).toBeNull();
  });

  it('solo refresh válido: renueva las cookies y redirige al dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json(200, { data: { accessToken: 'nuevo', refreshToken: 'nuevo-r' } })),
    );
    const res = await middleware(req('/login', { k_refresh: 'r' }));
    expect(location(res)).toBe('http://localhost:3000/dashboard');
    expect(res.cookies.get('k_access')?.value).toBe('nuevo');
    expect(res.cookies.get('k_refresh')?.value).toBe('nuevo-r');
  });

  it('sesión vencida (refresh rechazado): muestra el formulario y limpia las cookies', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(401)));
    const res = await middleware(req('/registro', { k_refresh: 'r' }));
    expect(location(res)).toBeNull();
    expect(res.cookies.get('k_refresh')?.value).toBe('');
  });

  it('API caída: muestra el formulario y NO toca la sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    const res = await middleware(req('/login', { k_access: 'a', k_refresh: 'r' }));
    expect(location(res)).toBeNull();
    expect(res.cookies.get('k_refresh')).toBeUndefined();
  });
});
