jest.mock('./api', () => ({ apiFetch: jest.fn() }));
jest.mock('./session', () => ({
  getSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

import { apiFetch } from './api';
import { clearSession, getSession, saveSession } from './session';
import { authedFetch } from './api-client';

const mockFetch = apiFetch as jest.Mock;
const mockGetSession = getSession as jest.Mock;
const SESSION = { accessToken: 'acc', refreshToken: 'ref', validUntil: Date.now() + 1000 };

beforeEach(() => jest.clearAllMocks());

describe('authedFetch — Bearer + refresh 401→retry', () => {
  it('sin sesión local → unauthenticated (no toca la red)', async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await authedFetch('/x')).toEqual({ status: 'unauthenticated', data: null, error: null });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('200 directo → pasa el token y devuelve la respuesta', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 200, data: { ok: 1 }, error: null });
    const res = await authedFetch('/x');
    expect(res).toEqual({ status: 200, data: { ok: 1 }, error: null });
    expect(mockFetch).toHaveBeenCalledWith('/x', expect.objectContaining({ token: 'acc' }));
  });

  it('sin red (status 0) → propaga 0, no intenta refrescar', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 0, data: null, error: null });
    expect((await authedFetch('/x')).status).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('401 → refresca y reintenta con el nuevo token → 200', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce({ status: 401, data: null, error: null }) // petición original
      .mockResolvedValueOnce({ status: 200, data: { accessToken: 'a2', refreshToken: 'r2' }, error: null }) // refresh
      .mockResolvedValueOnce({ status: 200, data: { ok: 1 }, error: null }); // reintento
    const res = await authedFetch('/x');
    expect(res).toEqual({ status: 200, data: { ok: 1 }, error: null });
    expect(saveSession).toHaveBeenCalledWith({ accessToken: 'a2', refreshToken: 'r2' });
    expect(mockFetch).toHaveBeenLastCalledWith('/x', expect.objectContaining({ token: 'a2' }));
  });

  it('401 + refresh rechazado por el server → limpia sesión y devuelve el 401', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce({ status: 401, data: null, error: null }) // petición original
      .mockResolvedValueOnce({ status: 401, data: null, error: null }); // refresh rechazado
    const res = await authedFetch('/x');
    expect(res.status).toBe(401);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2); // no reintenta
  });

  it('refresh OK pero el reintento sigue 401 → limpia sesión (sesión revocada, no red)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce({ status: 401, data: null, error: null }) // original
      .mockResolvedValueOnce({ status: 200, data: { accessToken: 'a2', refreshToken: 'r2' }, error: null }) // refresh OK
      .mockResolvedValueOnce({ status: 401, data: null, error: null }); // reintento sigue 401
    const res = await authedFetch('/x');
    expect(res.status).toBe(401);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('single-flight: dos 401 concurrentes comparten UN solo /auth/refresh', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockImplementation((path: string, init: { token?: string }) => {
      if (path === '/auth/refresh')
        return Promise.resolve({ status: 200, data: { accessToken: 'a2', refreshToken: 'r2' }, error: null });
      if (init?.token === 'acc') return Promise.resolve({ status: 401, data: null, error: null }); // token viejo
      return Promise.resolve({ status: 200, data: { ok: 1 }, error: null }); // token nuevo → OK
    });
    const [r1, r2] = await Promise.all([authedFetch('/x'), authedFetch('/y')]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const refreshCalls = mockFetch.mock.calls.filter(([p]: [string]) => p === '/auth/refresh');
    expect(refreshCalls).toHaveLength(1); // sin single-flight serían 2 → el 2º rota el token y provoca logout
  });
});
