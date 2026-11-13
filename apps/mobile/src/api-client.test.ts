jest.mock('./api', () => ({ apiFetch: jest.fn() }));
jest.mock('./session', () => ({
  getSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

import { apiFetch } from './api';
import { clearSession, getSession, saveSession } from './session';
import { apiMutate, authedFetch } from './api-client';
import { takeSessionNotice } from './session-notice';

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

describe('apiMutate — timeout vs offline', () => {
  it('propaga el motivo: un timeout NO es lo mismo que sin red (el pedido pudo haber llegado)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 0, reason: 'timeout', data: null, error: null });
    expect(await apiMutate('/x', 'POST', {})).toEqual({ status: 'offline', reason: 'timeout' });
    mockFetch.mockResolvedValue({ status: 0, reason: 'offline', data: null, error: null });
    expect(await apiMutate('/x', 'POST', {})).toEqual({ status: 'offline', reason: 'offline' });
  });
});

describe('authedFetch — 401 por credencial equivocada no es sesión muerta', () => {
  it.each(['AUTH_001', 'AUTH_006'])('%s: devuelve el 401 sin refrescar ni limpiar la sesión', async (code) => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 401, data: null, error: { code, message: 'Credenciales inválidas' } });
    const res = await authedFetch('/auth/change-password', { method: 'POST', body: {} });
    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no pidió refresh
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('un 401 de token (AUTH_003) sí sigue el camino de refresh', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce({ status: 401, data: null, error: { code: 'AUTH_003', message: 'x' } })
      .mockResolvedValueOnce({ status: 200, data: { accessToken: 'a2', refreshToken: 'r2' }, error: null })
      .mockResolvedValueOnce({ status: 200, data: { ok: 1 }, error: null });
    expect((await authedFetch('/x')).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('authedFetch — AUTHZ_STALE (F14 · F1, H-2)', () => {
  const stale = { status: 401, data: null, error: { code: 'AUTHZ_STALE', message: 'x' } };

  it('AUTHZ_STALE → refresca y reintenta UNA vez con el token nuevo → 200', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce({ status: 200, data: { accessToken: 'a2', refreshToken: 'r2' }, error: null })
      .mockResolvedValueOnce({ status: 200, data: { ok: 1 }, error: null });
    const res = await authedFetch('/x');
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenLastCalledWith('/x', expect.objectContaining({ token: 'a2' }));
  });

  it('segundo AUTHZ_STALE tras refrescar → no reintenta otra vez y limpia la sesión (login)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce({ status: 200, data: { accessToken: 'a2', refreshToken: 'r2' }, error: null })
      .mockResolvedValueOnce(stale);
    const res = await authedFetch('/x');
    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(clearSession).toHaveBeenCalled();
  });
});

describe('refresh rechazado por rol fuera del móvil (F14 · F8, D-3)', () => {
  it('🔴 403 MOBILE_ROLE_NOT_ALLOWED → limpia la sesión Y deja el aviso para el ingreso', async () => {
    takeSessionNotice();
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce({ status: 401, data: null, error: { code: 'AUTH_003', message: 'x' } }) // petición original
      .mockResolvedValueOnce({ status: 403, data: null, error: { code: 'MOBILE_ROLE_NOT_ALLOWED', message: 'Tu rol se usa desde la web: entra desde el navegador' } }); // refresh
    const res = await authedFetch('/x');
    expect(res.status).toBe(401);
    expect(clearSession).toHaveBeenCalled();
    expect(takeSessionNotice()).toBe('Tu rol se usa desde la web: entra desde el navegador');
  });

  it('un refresh rechazado por otra razón no deja ningún aviso', async () => {
    takeSessionNotice();
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce({ status: 401, data: null, error: { code: 'AUTH_003', message: 'x' } })
      .mockResolvedValueOnce({ status: 401, data: null, error: { code: 'AUTH_003', message: 'sesión vencida' } });
    await authedFetch('/x');
    expect(takeSessionNotice()).toBeNull();
  });
});
