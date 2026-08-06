jest.mock('./api', () => ({ apiFetch: jest.fn() }));
jest.mock('./session', () => ({
  getSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
  touchSession: jest.fn(),
  // `me()` guarda quién es para poder encolar acciones sin red (P6).
  saveUserId: jest.fn(),
}));

import { apiFetch } from './api';
import { clearSession, getSession, touchSession } from './session';
import { authService, type Me } from './auth-service';

const mockFetch = apiFetch as jest.Mock;
const mockGetSession = getSession as jest.Mock;

const SESSION = { accessToken: 'acc', refreshToken: 'ref', validUntil: Date.now() + 1000 };
const ME: Me = {
  userId: 'u1',
  email: 'a@kobrax.demo',
  profile: null,
  accountId: 'acc1',
  role: 'COLLECTOR',
  permissions: [],
  mfaEnabled: false,
  requiresPasswordChange: false,
};

beforeEach(() => jest.clearAllMocks());

describe('authService.me — distingue offline de no autenticado (historia 14)', () => {
  it('sin sesión local → unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await authService.me()).toEqual({ status: 'unauthenticated' });
  });

  it('fallo de red (status 0) con sesión vigente → offline (no manda al login)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 0, data: null, error: null });
    expect(await authService.me()).toEqual({ status: 'offline' });
  });

  it('200 → ok + renueva la ventana de inactividad (touchSession)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 200, data: ME, error: null });
    expect(await authService.me()).toEqual({ status: 'ok', me: ME });
    expect(touchSession).toHaveBeenCalledTimes(1);
  });

  it('access expirado (401) → refresca y reintenta → ok', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch
      .mockResolvedValueOnce({ status: 401, data: null, error: null }) // /auth/me
      .mockResolvedValueOnce({ status: 200, data: { accessToken: 'a2', refreshToken: 'r2' }, error: null }) // /auth/refresh
      .mockResolvedValueOnce({ status: 200, data: ME, error: null }); // /auth/me reintento
    expect(await authService.me()).toEqual({ status: 'ok', me: ME });
  });
});

describe('authService.forgotPassword', () => {
  it('200 → ok', async () => {
    mockFetch.mockResolvedValue({ status: 200, data: { ok: true }, error: null });
    expect(await authService.forgotPassword('a@kobrax.demo')).toEqual({ ok: true });
  });

  it('429 → mensaje de rate-limit', async () => {
    mockFetch.mockResolvedValue({ status: 429, data: null, error: null });
    const res = await authService.forgotPassword('a@kobrax.demo');
    expect(res).toHaveProperty('error');
  });

  it('sin red → error de conexión', async () => {
    mockFetch.mockResolvedValue({ status: 0, data: null, error: null });
    expect(await authService.forgotPassword('a@kobrax.demo')).toHaveProperty('error');
  });
});

describe('authService.changePassword', () => {
  it('en éxito limpia la sesión local (el backend revoca todas)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 200, data: { ok: true }, error: null });
    expect(await authService.changePassword('Old1!', 'Kobrax123!')).toEqual({ ok: true });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('en error NO limpia la sesión', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 400, data: null, error: { code: 'AUTH_008', message: 'débil' } });
    expect(await authService.changePassword('Old1!', 'weak')).toHaveProperty('error');
    expect(clearSession).not.toHaveBeenCalled();
  });
});
