// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jar, reqHeaders, ctx } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  reqHeaders: new Map<string, string>(),
  /** `writable: false` simula una pantalla de servidor, donde `cookies().set` lanza. */
  ctx: { writable: true },
}));
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined),
    set: (n: string, v: string) => {
      if (!ctx.writable) throw new Error('Cookies can only be modified in a Server Action or Route Handler');
      jar.set(n, v);
    },
  }),
  headers: () => ({ get: (n: string) => reqHeaders.get(n) ?? null }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { apiCall } from './bff';

const jwt = (sessionId: string) => `h.${btoa(JSON.stringify({ sessionId }))}.s`;

beforeEach(() => {
  ctx.writable = true;
  jar.clear();
  reqHeaders.clear();
  vi.restoreAllMocks();
});

describe('apiCall · control de sesión (W-LOG-54)', () => {
  it('x-k-session distinto al de la cookie: 409 SESSION_CHANGED y NO llama a la API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    jar.set('k_access', jwt('nueva'));
    reqHeaders.set('x-k-session', 'vieja');
    const { status, body } = await apiCall('/payments', { method: 'POST', auth: true, body: '{}' });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('SESSION_CHANGED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('x-k-session igual al de la cookie: pasa a la API con el Bearer', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 }));
    jar.set('k_access', jwt('misma'));
    reqHeaders.set('x-k-session', 'misma');
    const { status } = await apiCall('/auth/me', { auth: true });
    expect(status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sin header (navegación normal, pantallas de servidor): no se compara nada', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"data":{}}', { status: 200 }));
    jar.set('k_access', jwt('cualquiera'));
    const { status } = await apiCall('/auth/me', { auth: true });
    expect(status).toBe(200);
  });
});

describe('apiCall · AUTHZ_STALE (F14 · F1, H-2)', () => {
  const stale = () => new Response(JSON.stringify({ data: null, error: { code: 'AUTHZ_STALE', message: 'x' } }), { status: 401 });
  const ok = () => new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 });
  const refreshed = () => new Response(JSON.stringify({ data: { accessToken: 'nuevo', refreshToken: 'r2' } }), { status: 200 });

  it('renueva y reintenta UNA vez con el access nuevo; guarda las cookies', async () => {
    jar.set('k_access', jwt('s')); jar.set('k_refresh', 'r1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(stale()).mockResolvedValueOnce(refreshed()).mockResolvedValueOnce(ok());
    const { status } = await apiCall('/clients', { auth: true });
    expect(status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect((fetchSpy.mock.calls[2]![1]!.headers as Headers).get('authorization')).toBe('Bearer nuevo');
    expect(jar.get('k_access')).toBe('nuevo');
    expect(jar.get('k_refresh')).toBe('r2');
  });

  it('un segundo AUTHZ_STALE tras renovar NO reintenta otra vez (devuelve el 401)', async () => {
    jar.set('k_access', jwt('s')); jar.set('k_refresh', 'r1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(stale()).mockResolvedValueOnce(refreshed()).mockResolvedValueOnce(stale());
    const { status, body } = await apiCall('/clients', { auth: true });
    expect(status).toBe(401);
    expect(body.error?.code).toBe('AUTHZ_STALE');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('ya se renovó hace instantes (k_renewed): no renueva, no hay bucle', async () => {
    jar.set('k_access', jwt('s')); jar.set('k_refresh', 'r1'); jar.set('k_renewed', '1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(stale());
    const { status } = await apiCall('/clients', { auth: true });
    expect(status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('pantalla de servidor (no puede escribir cookies): NO quema el refresh, redirige a /api/auth/renew', async () => {
    ctx.writable = false;
    jar.set('k_access', jwt('s')); jar.set('k_refresh', 'r1');
    reqHeaders.set('x-k-path', '/cartera?page=2');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(stale());
    await expect(apiCall('/clients', { auth: true })).rejects.toThrow('NEXT_REDIRECT:/api/auth/renew?next=%2Fcartera%3Fpage%3D2');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // sólo la llamada original: el refresh sigue vivo
  });

  it('otros 401 (sesión revocada) no se renuevan', async () => {
    jar.set('k_access', jwt('s')); jar.set('k_refresh', 'r1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: null, error: { code: 'AUTH_003' } }), { status: 401 }));
    const { status } = await apiCall('/clients', { auth: true });
    expect(status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
