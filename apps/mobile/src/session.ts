import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '@kobrax/shared';
import { clearCache } from './db';

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
  userId: 'k_user_id',
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

/**
 * Quién es el cobrador de esta sesión. Se guarda cuando `me()` responde, y hace falta **sin red**:
 * la cola de acciones pendientes es de una persona, y al abrir la app en modo avión no hay a quién
 * preguntárselo. El token lo lleva adentro, pero decodificar un JWT a mano para esto es más frágil
 * que persistir el dato.
 */
export async function saveUserId(userId: string): Promise<void> {
  await SecureStore.setItemAsync(KEY.userId, userId);
}

export function getUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY.userId);
}

/**
 * Cierra la sesión y **borra la copia local de los datos del tenant**.
 *
 * El borrado vive acá y no en `authService.logout()` por una razón concreta: hay cuatro caminos que
 * terminan una sesión y sólo uno es el botón de "cerrar sesión" — el refresh rechazado por el
 * servidor (`api-client`), el logout desde la pantalla de sin conexión, el "usar contraseña" del
 * desbloqueo y el cambio de contraseña. Todos pasan por acá. Con el borrado en `logout()`, un
 * cobrador cuya sesión moría por cualquiera de los otros tres le dejaba su cartera —nombres,
 * teléfonos y direcciones— al siguiente que entrara en ese teléfono, que puede ser de otro tenant.
 *
 * **La cola NO se borra** (plan §Q3): es trabajo sin entregar, puede ser un pago, y queda guardada
 * con su dueño para cuando vuelva a entrar.
 */
export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY.access),
    SecureStore.deleteItemAsync(KEY.refresh),
    SecureStore.deleteItemAsync(KEY.validUntil),
    SecureStore.deleteItemAsync(KEY.userId),
    clearCache(),
  ]);
}

/** True si la sesión offline aún es válida (no expiró la ventana de inactividad). */
export function isSessionValid(session: StoredSession | null): session is StoredSession {
  return !!session && Date.now() < session.validUntil;
}

/**
 * Ventana de gracia al volver a primer plano.
 *
 * ponytail: 60 s fijos. Android pausa la Activity ante un diálogo de permisos, la cámara, el
 * selector de fotos o al saltar a WhatsApp, y RN reporta todo eso igual que un background real.
 * Sin la ventana, volver de cualquiera de esos rebotaba al cobrador al splash → Inicio, perdiendo
 * el formulario a medio llenar. Si alguna vez hace falta afinarlo por tenant, se vuelve config.
 */
export const LOCK_GRACE_MS = 60_000;

/**
 * ¿Hay que volver al splash (re-login / desbloqueo biométrico) al regresar a primer plano?
 * Endurecimiento F2b historia 15. La expiración de la ventana de inactividad manda siempre;
 * la biometría sólo re-bloquea si el usuario estuvo fuera más que `LOCK_GRACE_MS`.
 */
export function shouldRelock(opts: {
  session: StoredSession | null;
  awayMs: number;
  biometricEnabled: boolean;
}): boolean {
  if (!opts.session) return false; // sin sesión ya está en login; no hay a dónde rebotar
  if (!isSessionValid(opts.session)) return true;
  return opts.biometricEnabled && opts.awayMs >= LOCK_GRACE_MS;
}
