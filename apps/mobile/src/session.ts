import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '@kobrax/shared';

/**
 * Almacenamiento seguro de la sesión (SecureStore, hardware-backed; nunca AsyncStorage).
 * Modelo offline (EPIC-F2a §9): además de los tokens se guarda `sessionValidUntil` =
 * min(vida del refresh 7d, now + 8h de inactividad). El acceso offline se permite
 * mientras `now < sessionValidUntil` (la biometría que lo desbloquea llega en F2b).
 */
const KEY = {
  access: 'k_access',
  refresh: 'k_refresh',
  validUntil: 'k_session_valid_until',
} as const;

const INACTIVITY_MS = 8 * 60 * 60 * 1000; // 8h
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7d

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  validUntil: number;
}

/** Persiste la sesión y (re)calcula la ventana de validez offline. */
export async function saveSession(tokens: AuthTokens): Promise<void> {
  const validUntil = Date.now() + Math.min(REFRESH_MS, INACTIVITY_MS);
  await Promise.all([
    SecureStore.setItemAsync(KEY.access, tokens.accessToken),
    SecureStore.setItemAsync(KEY.refresh, tokens.refreshToken),
    SecureStore.setItemAsync(KEY.validUntil, String(validUntil)),
  ]);
}

export async function getSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken, validUntilRaw] = await Promise.all([
    SecureStore.getItemAsync(KEY.access),
    SecureStore.getItemAsync(KEY.refresh),
    SecureStore.getItemAsync(KEY.validUntil),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, validUntil: Number(validUntilRaw ?? 0) };
}

/**
 * Renueva la ventana de inactividad (8h) sin tocar los tokens. Se llama ante
 * actividad con red (p.ej. un `me()` exitoso) — endurecimiento F2b historia 15:
 * timeout de inactividad. La ventana nunca se extiende si no hay sesión.
 */
export async function touchSession(): Promise<void> {
  const access = await SecureStore.getItemAsync(KEY.access);
  if (!access) return;
  const validUntil = Date.now() + Math.min(REFRESH_MS, INACTIVITY_MS);
  await SecureStore.setItemAsync(KEY.validUntil, String(validUntil));
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY.access),
    SecureStore.deleteItemAsync(KEY.refresh),
    SecureStore.deleteItemAsync(KEY.validUntil),
  ]);
}

/** True si la sesión offline aún es válida (no expiró la ventana de inactividad). */
export function isSessionValid(session: StoredSession | null): session is StoredSession {
  return !!session && Date.now() < session.validUntil;
}
