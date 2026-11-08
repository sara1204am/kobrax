import { clearImageCache } from './image-cache';
import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '@kobrax/shared';
import { clearCache } from './db';
import { cancelAllAgendaReminders } from './agenda-notifications';
import { useMeStore } from './store/me';

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
  /** F14 · F8: cuánto dura la ventana sin conexión de ESTA persona (ms), según sus permisos. */
  window: 'k_offline_window_ms',
} as const;

/**
 * El borrador de la ruta (`route-draft.ts`) se guarda **por usuario**: `kobrax.route.draft.<userId>`. La clave
 * sin sufijo es la de versiones anteriores, que no distinguía de quién era: se descarta, no se migra.
 */
export const ROUTE_DRAFT_KEY = 'kobrax.route.draft';
export const routeDraftKey = (userId: string) => `${ROUTE_DRAFT_KEY}.${userId}`;

/** Borra el borrador legado (sin dueño) y el del usuario indicado (o el de la sesión actual). */
export async function clearRouteDrafts(userId?: string | null): Promise<void> {
  const uid = userId ?? (await SecureStore.getItemAsync(KEY.userId));
  await SecureStore.deleteItemAsync(ROUTE_DRAFT_KEY);
  if (uid) await SecureStore.deleteItemAsync(routeDraftKey(uid));
}

const INACTIVITY_MS = 8 * 60 * 60 * 1000; // 8h
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7d
/** F14 · F8 (H-10, ADR-F14-11): quien asigna trabajo o administra personas tiene una ventana sin conexión más corta. */
export const SUPERVISION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h
export const FIELD_WINDOW_MS = INACTIVITY_MS;

/**
 * F14 · F8 (D-2): cuánto vale la sesión sin poder preguntarle al servidor.
 *
 *  · 8 h para el cobrador;
 *  · 2 h para quien tiene `assignment:write` o `user:write` (reparte cartera o administra personas): un teléfono perdido de esa persona
 *    deja más a la vista;
 *  · **8 h para la cuenta de UNA sola persona** (el cobrador independiente es su propio administrador, no tiene a quién asignar, y
 *    degradarlo no daría ninguna seguridad: RULES C).
 *
 * Sin permisos conocidos (todavía no se leyó `me`) se usa la de campo; `me()` la corrige en cuanto responde.
 */
export function offlineWindowMs(opts: { permissions?: readonly string[] | null; soloUser?: boolean | null }): number {
  if (opts.soloUser) return FIELD_WINDOW_MS;
  const perms = opts.permissions ?? [];
  return perms.includes('assignment:write') || perms.includes('user:write') ? SUPERVISION_WINDOW_MS : FIELD_WINDOW_MS;
}

/** La ventana guardada (la última que fijó `me()`); sin una válida, la de campo. */
async function storedWindowMs(): Promise<number> {
  const raw = Number(await SecureStore.getItemAsync(KEY.window));
  return Number.isFinite(raw) && raw >= 60_000 && raw <= INACTIVITY_MS ? raw : INACTIVITY_MS;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  validUntil: number;
}

/** Persiste la sesión y (re)calcula la ventana de validez offline. */
export async function saveSession(tokens: AuthTokens): Promise<void> {
  // La ventana de quien ya está identificado se conserva al renovar el token (un refresh no la alarga de 2 h a 8 h).
  const validUntil = Date.now() + Math.min(REFRESH_MS, await storedWindowMs());
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
export async function touchSession(windowMs?: number): Promise<void> {
  const access = await SecureStore.getItemAsync(KEY.access);
  if (!access) return;
  // `windowMs` lo pasa `me()` con la ventana que le corresponde a esta persona (F14 · F8); sin él, la última guardada.
  if (windowMs !== undefined) await SecureStore.setItemAsync(KEY.window, String(windowMs));
  const validUntil = Date.now() + Math.min(REFRESH_MS, windowMs ?? (await storedWindowMs()));
  await SecureStore.setItemAsync(KEY.validUntil, String(validUntil));
}

/**
 * Quién es el cobrador de esta sesión. Se guarda cuando `me()` responde, y hace falta **sin red**:
 * la cola de acciones pendientes es de una persona, y al abrir la app en modo avión no hay a quién
 * preguntárselo. El token lo lleva adentro, pero decodificar un JWT a mano para esto es más frágil
 * que persistir el dato.
 */
export async function saveUserId(userId: string): Promise<void> {
  // Cambió la persona de este teléfono: el recorrido a medio armar del anterior no es de la que entra.
  const previo = await SecureStore.getItemAsync(KEY.userId);
  if (previo && previo !== userId) await clearRouteDrafts(previo);
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
  // Los avisos locales son de quien salió: no pueden sonarle al próximo que use este teléfono.
  await cancelAllAgendaReminders();
  // Antes de borrar el userId: el borrador es por usuario y hace falta saber de quién era.
  await clearRouteDrafts();
  // Fotos de viviendas y personas: son de quien salió.
  await clearImageCache();
  await Promise.all([
    SecureStore.deleteItemAsync(KEY.access),
    SecureStore.deleteItemAsync(KEY.refresh),
    SecureStore.deleteItemAsync(KEY.validUntil),
    SecureStore.deleteItemAsync(KEY.userId),
    SecureStore.deleteItemAsync(KEY.window),
    clearCache(),
  ]);
  // Los permisos de quien salió no se le quedan al próximo (F14 · F8).
  useMeStore.getState().setMe(null);
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
