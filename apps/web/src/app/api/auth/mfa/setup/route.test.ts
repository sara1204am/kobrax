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

import { POST } from './route';

const post = (body: unknown) =>
  new Request('http://localhost/api/auth/mfa/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  cookieStore.clear();
  apiCall.mockReset();
});

describe('BFF mfa/setup · acción skip (W-LOG-51)', () => {
  it('llama a /auth/mfa/setup/skip con el pre-auth y completa el login (cookies)', async () => {
    cookieStore.set('k_preauth', 'pre');
    apiCall.mockResolvedValue({
      status: 200,
      body: { data: { step: 'done', accessToken: 'a', refreshToken: 'r' }, error: null, meta: {} },
    });
    const res = await POST(post({ action: 'skip' }));

    expect(apiCall).toHaveBeenCalledWith('/auth/mfa/setup/skip', {
      method: 'POST',
      body: JSON.stringify({ preAuthToken: 'pre' }),
    });
    expect(await res.json()).toMatchObject({ step: 'done' });
    expect(res.cookies.get('k_access')?.value).toBe('a');
  });

  it('con varias empresas devuelve el paso select_account y las cuentas', async () => {
    cookieStore.set('k_preauth', 'pre');
    const accounts = [{ id: 'a1', name: 'Demo', role: 'ACCOUNT_ADMIN', status: 'ACTIVE' }];
    apiCall.mockResolvedValue({
      status: 200,
      body: { data: { step: 'select_account', preAuthToken: 'pre2', accounts }, error: null, meta: {} },
    });
    const res = await POST(post({ action: 'skip' }));
    const json = await res.json();
    expect(json.step).toBe('select_account');
    expect(json.accounts).toEqual(accounts);
    expect(res.cookies.get('k_access')).toBeUndefined();
  });

  it('sin pre-auth responde 401 y no llama a la API', async () => {
    const res = await POST(post({ action: 'skip' }));
    expect(res.status).toBe(401);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('propaga el error de la API', async () => {
    cookieStore.set('k_preauth', 'pre');
    apiCall.mockResolvedValue({
      status: 401,
      body: { data: null, error: { code: 'AUTH_003', message: 'expirado' }, meta: {} },
    });
    const res = await POST(post({ action: 'skip' }));
    expect(res.status).toBe(401);
  });
});
