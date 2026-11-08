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
import { FIELD_WINDOW_MS, SUPERVISION_WINDOW_MS, clearSession, getSession, isSessionValid, offlineWindowMs, saveSession, touchSession } from './session';
import { canNow, useMeStore } from './store/me';

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


describe('offlineWindowMs · ventana sin conexión según el rol (F14 · F8, D-2 / H-10)', () => {
  it('el cobrador tiene 8 h', () => {
    expect(offlineWindowMs({ permissions: ['collection:read', 'payment:write'] })).toBe(8 * 3600_000);
    expect(FIELD_WINDOW_MS).toBe(8 * 3600_000);
  });

  it('🔴 quien reparte cartera (assignment:write) o administra personas (user:write) tiene 2 h', () => {
    expect(offlineWindowMs({ permissions: ['collection:read', 'assignment:write'] })).toBe(2 * 3600_000);
    expect(offlineWindowMs({ permissions: ['user:write'] })).toBe(SUPERVISION_WINDOW_MS);
  });

  it('🔴 la cuenta de UNA sola persona (el cobrador independiente) conserva 8 h aunque sea administrador', () => {
    expect(offlineWindowMs({ permissions: ['assignment:write', 'user:write'], soloUser: true })).toBe(8 * 3600_000);
    expect(offlineWindowMs({ permissions: ['assignment:write', 'user:write'], soloUser: false })).toBe(2 * 3600_000);
  });

  it('sin permisos conocidos (todavía no se leyó `me`) usa la de campo', () => {
    expect(offlineWindowMs({})).toBe(8 * 3600_000);
    expect(offlineWindowMs({ permissions: null })).toBe(8 * 3600_000);
  });
});

describe('la ventana de quien asigna se conserva (F14 · F8)', () => {
  it('🔴 touchSession(2 h) acorta la ventana y un REFRESH posterior no la alarga a 8 h', async () => {
    await saveSession(TOKENS);
    await touchSession(SUPERVISION_WINDOW_MS);
    const corta = (await getSession())!.validUntil - Date.now();
    expect(corta).toBeLessThanOrEqual(2 * 3600_000 + 1000);
    expect(corta).toBeGreaterThan(1.9 * 3600_000);

    await saveSession({ accessToken: 'nuevo', refreshToken: 'nuevo' }); // lo que hace el refresh silencioso
    const trasRefresh = (await getSession())!.validUntil - Date.now();
    expect(trasRefresh).toBeLessThanOrEqual(2 * 3600_000 + 1000);
  });

  it('touchSession sin argumento renueva con la última ventana guardada', async () => {
    await saveSession(TOKENS);
    await touchSession(SUPERVISION_WINDOW_MS);
    await SecureStore.setItemAsync('k_session_valid_until', String(Date.now() + 1000));
    await touchSession();
    expect((await getSession())!.validUntil - Date.now()).toBeLessThanOrEqual(2 * 3600_000 + 1000);
  });

  it('cerrar sesión borra la ventana: la persona siguiente empieza con la de campo', async () => {
    await saveSession(TOKENS);
    await touchSession(SUPERVISION_WINDOW_MS);
    await clearSession();
    await saveSession(TOKENS);
    expect((await getSession())!.validUntil - Date.now()).toBeGreaterThan(7.9 * 3600_000);
  });

  it('una ventana guardada fuera de rango se ignora (nunca más de 8 h)', async () => {
    await saveSession(TOKENS);
    await SecureStore.setItemAsync('k_offline_window_ms', String(99 * 3600_000));
    await saveSession(TOKENS);
    expect((await getSession())!.validUntil - Date.now()).toBeLessThanOrEqual(8 * 3600_000 + 1000);
  });
});

describe('store de `me` y permisos (F14 · F8, D-9)', () => {
  const me = (permissions: string[]) => ({ userId: 'u1', email: 'a@b.c', profile: null, accountId: 'a1', role: 'COLLECTOR', permissions, mfaEnabled: false, requiresPasswordChange: false });

  it('mientras `me` no se leyó NO se esconde nada (la API rechaza lo que no corresponda)', () => {
    useMeStore.getState().setMe(null);
    expect(canNow('agenda:read')).toBe(true);
  });

  it('con `me` leído, sólo se ofrece lo que tiene', () => {
    useMeStore.getState().setMe(me(['agenda:read']));
    expect(canNow('agenda:read')).toBe(true);
    expect(canNow('route:read')).toBe(false);
  });

  it('🔴 cerrar sesión vacía los permisos de quien salió', async () => {
    useMeStore.getState().setMe(me(['agenda:read']));
    await clearSession();
    expect(useMeStore.getState().me).toBeNull();
  });
});
