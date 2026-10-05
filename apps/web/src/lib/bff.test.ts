// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jar, reqHeaders } = vi.hoisted(() => ({ jar: new Map<string, string>(), reqHeaders: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined) }),
  headers: () => ({ get: (n: string) => reqHeaders.get(n) ?? null }),
}));

import { apiCall } from './bff';

const jwt = (sessionId: string) => `h.${btoa(JSON.stringify({ sessionId }))}.s`;

beforeEach(() => {
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
