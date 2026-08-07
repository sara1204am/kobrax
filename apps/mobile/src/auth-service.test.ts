jest.mock('./api', () => ({ apiFetch: jest.fn() }));
jest.mock('./session', () => ({
  getSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
  touchSession: jest.fn(),
  // `me()` guarda quién es para poder encolar acciones sin red (P6).
  saveUserId: jest.fn(),
  // Desde P6, sin red `me()` responde con la identidad guardada si la ventana sigue vigente.
  isSessionValid: jest.fn(() => false),
}));

/** La base local. Por defecto vacía: sin `me` guardado, sin red se sigue cayendo a offline. */
jest.mock('./db', () => ({ putOne: jest.fn(), getOne: jest.fn(async () => null) }));

import { apiFetch } from './api';
import { clearSession, getSession, isSessionValid, touchSession } from './session';
import { getOne } from './db';
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

  it('fallo de red (status 0) sin nada guardado → offline (no manda al login)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    mockFetch.mockResolvedValue({ status: 0, data: null, error: null });
    expect(await authService.me()).toEqual({ status: 'offline' });
  });

  /**
   * El caso que hace usable la app en el campo (P6 · R3): sin red, con la ventana de 8 h vigente y
   * el `me` ya guardado, se entra igual. Antes el arranque moría en la pantalla de sin conexión
   * aunque el teléfono tuviera la jornada entera descargada.
   */
  it('sin red, con sesión vigente y `me` guardado → ok (se puede trabajar offline)', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    (isSessionValid as unknown as jest.Mock).mockReturnValue(true);
    (getOne as jest.Mock).mockResolvedValue(ME);
    mockFetch.mockResolvedValue({ status: 0, data: null, error: null });
    expect(await authService.me()).toEqual({ status: 'ok', me: ME });
  });

  // Una identidad vieja no vale para siempre: vencida la ventana, hay que volver a entrar.
  it('sin red y con la ventana vencida → offline aunque haya `me` guardado', async () => {
    mockGetSession.mockResolvedValue(SESSION);
    (isSessionValid as unknown as jest.Mock).mockReturnValue(false);
    (getOne as jest.Mock).mockResolvedValue(ME);
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
