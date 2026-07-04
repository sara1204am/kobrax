jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

import * as SecureStore from 'expo-secure-store';
import { clearSession, getSession, isSessionValid, saveSession, touchSession } from './session';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
beforeEach(() => store.clear());

const TOKENS = { accessToken: 'acc', refreshToken: 'ref' };

describe('saveSession / getSession', () => {
  it('persiste tokens y calcula la ventana offline (~8h)', async () => {
    const before = Date.now();
    await saveSession(TOKENS);
    const session = await getSession();
    expect(session).toMatchObject(TOKENS);
    const window = session!.validUntil - before;
    expect(window).toBeGreaterThan(7.9 * 3600_000);
    expect(window).toBeLessThanOrEqual(8 * 3600_000 + 1000);
  });

  it('getSession devuelve null si faltan tokens', async () => {
    expect(await getSession()).toBeNull();
  });
});

describe('isSessionValid (type guard de la ventana offline)', () => {
  it('false para null o ventana vencida; true si sigue vigente', () => {
    expect(isSessionValid(null)).toBe(false);
    expect(isSessionValid({ ...TOKENS, validUntil: Date.now() - 1 })).toBe(false);
    expect(isSessionValid({ ...TOKENS, validUntil: Date.now() + 60_000 })).toBe(true);
  });
});

describe('touchSession (timeout de inactividad)', () => {
  it('renueva la ventana de validez sin tocar los tokens', async () => {
    await saveSession(TOKENS);
    // Simula que la ventana está a punto de vencer.
    await SecureStore.setItemAsync('k_session_valid_until', String(Date.now() + 1000));
    await touchSession();
    const session = await getSession();
    expect(session!.validUntil - Date.now()).toBeGreaterThan(7.9 * 3600_000);
  });

  it('no crea ventana si no hay sesión', async () => {
    await touchSession();
    expect(await SecureStore.getItemAsync('k_session_valid_until')).toBeNull();
  });
});

describe('clearSession', () => {
  it('elimina todas las claves de sesión', async () => {
    await saveSession(TOKENS);
    await clearSession();
    expect(await getSession()).toBeNull();
  });
});
