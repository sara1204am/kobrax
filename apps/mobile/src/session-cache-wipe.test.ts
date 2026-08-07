/**
 * El caché local guarda la cartera del tenant: nombres, teléfonos y direcciones de deudores. Estos
 * casos fijan las dos barreras que impiden que esos datos queden para el siguiente que use el
 * teléfono — que puede ser de OTRO tenant, porque el login es por email global.
 *
 * Nace de una revisión de seguridad: el borrado estaba sólo en el botón de "cerrar sesión", y hay
 * cuatro caminos que terminan una sesión (refresh rechazado, logout desde la pantalla de offline,
 * "usar contraseña" del desbloqueo, cambio de contraseña). Los cuatro pasan por `clearSession`.
 */
const mockStore = new Map<string, string>();
const mockDb = { cacheBorrado: 0, sessionMe: null as unknown };

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

jest.mock('./db', () => ({
  clearCache: jest.fn(async () => {
    mockDb.cacheBorrado += 1;
  }),
  getOne: jest.fn(async () => mockDb.sessionMe),
  putOne: jest.fn(async () => {}),
}));

jest.mock('./api', () => ({ apiFetch: jest.fn(async () => ({ status: 200, data: null, error: null })) }));
jest.mock('./api-client', () => ({ authedFetch: jest.fn(async () => mockAuthed.res) }));
const mockAuthed = { res: {} as Record<string, unknown> };

import { clearSession, saveSession } from './session';
import { authService } from './auth-service';

const ME = { userId: 'u1', accountId: 'acc1', email: 'a@k.demo', role: 'COLLECTOR', permissions: [] };

beforeEach(() => {
  mockStore.clear();
  mockDb.cacheBorrado = 0;
  mockDb.sessionMe = null;
});

describe('clearSession', () => {
  it('borra la copia local de los datos del tenant', async () => {
    await clearSession();
    expect(mockDb.cacheBorrado).toBe(1);
  });

  it('borra también los tokens y el userId', async () => {
    await saveSession({ accessToken: 'a', refreshToken: 'r' } as never);
    mockStore.set('k_user_id', 'u1');
    await clearSession();
    expect(mockStore.get('k_access')).toBeUndefined();
    expect(mockStore.get('k_refresh')).toBeUndefined();
    expect(mockStore.get('k_user_id')).toBeUndefined();
  });
});

describe('me() · segunda barrera', () => {
  it('si entra OTRA persona, tira el caché del anterior', async () => {
    mockDb.sessionMe = { ...ME, userId: 'u-anterior' };
    mockAuthed.res = { status: 200, data: ME, error: null };
    await authService.me();
    expect(mockDb.cacheBorrado).toBe(1);
  });

  // El caso más grave: el login es por email global, así que el siguiente puede ser de otro tenant.
  it('si entra el mismo usuario pero en OTRO tenant, también lo tira', async () => {
    mockDb.sessionMe = { ...ME, accountId: 'acc-otro' };
    mockAuthed.res = { status: 200, data: ME, error: null };
    await authService.me();
    expect(mockDb.cacheBorrado).toBe(1);
  });

  it('si es la misma persona y el mismo tenant, NO borra nada', async () => {
    mockDb.sessionMe = { ...ME };
    mockAuthed.res = { status: 200, data: ME, error: null };
    await authService.me();
    expect(mockDb.cacheBorrado).toBe(0);
  });

  it('en el primer login del teléfono no hay nada que borrar', async () => {
    mockDb.sessionMe = null;
    mockAuthed.res = { status: 200, data: ME, error: null };
    await authService.me();
    expect(mockDb.cacheBorrado).toBe(0);
  });
});
