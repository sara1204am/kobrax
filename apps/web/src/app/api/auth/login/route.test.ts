// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { cookieStore, apiCall } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  apiCall: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined) }),
}));
vi.mock('@/lib/bff', async (orig) => ({ ...(await orig<typeof import('@/lib/bff')>()), apiCall }));

import { POST as login } from './route';
import { POST as registro } from '../registro/route';
import { POST as invitacion } from '../invitacion/route';

const post = (body: unknown) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ok = (data: unknown) => ({ status: 200, body: { data, error: null, meta: {} } });
const logoutCalls = () => apiCall.mock.calls.filter(([p]) => p === '/auth/logout');

beforeEach(() => {
  cookieStore.clear();
  apiCall.mockReset();
});

describe('BFF · defensa de sesión previa (W-LOG-54)', () => {
  it('login con cookies de otra sesión: revoca la anterior con su refresh', async () => {
    cookieStore.set('k_refresh', 'viejo');
    apiCall.mockImplementation(async (p: string) =>
      p === '/auth/login' ? ok({ step: 'done', accessToken: 'n', refreshToken: 'nr' }) : { status: 204, body: {} },
    );
    const res = await login(post({ email: 'a@b.co', password: 'x' }));
    expect(res.cookies.get('k_refresh')?.value).toBe('nr');
    expect(logoutCalls()).toHaveLength(1);
    expect(JSON.parse(logoutCalls()[0][1].body)).toEqual({ refreshToken: 'viejo' });
  });

  it('login sin sesión previa: no llama a logout', async () => {
    apiCall.mockResolvedValue(ok({ step: 'done', accessToken: 'n', refreshToken: 'nr' }));
    await login(post({ email: 'a@b.co', password: 'x' }));
    expect(logoutCalls()).toHaveLength(0);
  });

  it('login fallido (contraseña mala) NO cierra la sesión que había', async () => {
    cookieStore.set('k_refresh', 'viejo');
    apiCall.mockResolvedValue({
      status: 401,
      body: { data: null, error: { code: 'AUTH_001', message: 'Credenciales inválidas' }, meta: {} },
    });
    const res = await login(post({ email: 'a@b.co', password: 'mala' }));
    expect(res.status).toBe(401);
    expect(logoutCalls()).toHaveLength(0);
  });

  it('registro e invitación con sesión previa: la revocan y limpian sus cookies', async () => {
    const casos = [
      [registro, { businessName: 'N', firstName: 'A', lastName: 'B', email: 'a@b.co', password: 'x' }],
      [invitacion, { code: 'ABCD-EFGH', password: 'x' }],
    ] as const;
    for (const [handler, body] of casos) {
      apiCall.mockReset();
      cookieStore.set('k_refresh', 'viejo');
      apiCall.mockImplementation(async (p: string) =>
        p === '/auth/logout' ? { status: 204, body: {} } : ok({ email: 'a@b.co' }),
      );
      const res = await handler(post(body));
      expect(logoutCalls()).toHaveLength(1);
      expect(res.cookies.get('k_refresh')?.value).toBe('');
    }
  });
});
