/**
 * Sincronización de la sesión entre pestañas del mismo navegador (W-LOG-54).
 *
 * Las cookies `k_access`/`k_refresh` son del navegador, no de la pestaña: login, cambio de empresa
 * y logout las cambian para todas, pero una pestaña que ya estaba abierta sigue mostrando al
 * usuario/empresa anterior mientras trabaja con la cuenta nueva. Dos capas:
 *
 * 1. **Aviso** (este archivo + `SessionWatcher`): al terminar login/logout/cambio de empresa se
 *    publica un evento; cada pestaña lo escucha y además se vuelve a comprobar al recuperar el
 *    foco. Logout → `/login`; otro usuario o empresa → recarga con un aviso.
 * 2. **Control en el servidor** (`bff.ts`): cada pedido lleva `x-k-session` con la sesión con la
 *    que se cargó la página; si ya no coincide con la cookie, el BFF contesta 409 y no guarda nada.
 */

export const SESSION_CHANNEL = 'kobrax-auth';
/** Respaldo para navegadores sin `BroadcastChannel`: el evento `storage` llega a las OTRAS pestañas. */
const STORAGE_KEY = 'k_auth_event';
/** Header con la sesión con la que se cargó la pestaña (lo compara `apiCall`). */
export const SESSION_HEADER = 'x-k-session';
/** Código del 409 que devuelve el BFF cuando la sesión de la pestaña ya no es la de la cookie. */
export const SESSION_CHANGED_CODE = 'SESSION_CHANGED';
/** Evento de `window` que dispara `sendJson` al recibir ese 409. */
export const SESSION_STALE_EVENT = 'k:session-stale';
/** Marca en sessionStorage: tras la recarga se muestra el aviso «Tu sesión cambió…». */
export const SESSION_NOTICE_KEY = 'k_session_notice';

export type SessionEventType = 'login' | 'logout' | 'switch';
export interface SessionEvent {
  type: SessionEventType;
  /** Pestaña que lo publicó: un `BroadcastChannel` también entrega a otras instancias del mismo documento. */
  from?: string;
}

/** Identifica esta pestaña para no reaccionar a los eventos propios. */
const TAB_ID = Math.random().toString(36).slice(2);

/** La identidad con la que se cargó la pestaña (viene de `/auth/me` en el layout). */
export interface LoadedSession {
  userId?: string;
  accountId: string;
  sessionId?: string;
}

/** Sesión con la que se cargó esta pestaña; `sendJson` la manda en `x-k-session`. */
let loadedSessionId: string | null = null;
export function setLoadedSessionId(id: string | null | undefined): void {
  loadedSessionId = id ?? null;
}
export function getLoadedSessionId(): string | null {
  return loadedSessionId;
}

/** Avisa a las demás pestañas que la sesión cambió. Nunca rompe: sin canal no hay a quién avisar. */
export function publishSessionEvent(type: SessionEventType): void {
  const event: SessionEvent = { type, from: TAB_ID };
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(SESSION_CHANNEL);
      channel.postMessage(event);
      channel.close();
    }
  } catch {
    /* sin BroadcastChannel: queda el respaldo de abajo */
  }
  try {
    // El valor cambia siempre (marca de tiempo) para que `storage` dispare aunque el tipo se repita.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...event, at: Date.now() }));
  } catch {
    /* almacenamiento bloqueado */
  }
}

/** Escucha los eventos de las OTRAS pestañas. Devuelve la función para dejar de escuchar. */
export function subscribeSessionEvents(handler: (event: SessionEvent) => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(SESSION_CHANNEL);
      channel.onmessage = (e: MessageEvent<SessionEvent>) => {
        if (e.data?.type && e.data.from !== TAB_ID) handler(e.data);
      };
    }
  } catch {
    channel = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as SessionEvent;
      if (parsed?.type && parsed.from !== TAB_ID) handler(parsed);
    } catch {
      /* valor ajeno */
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    channel?.close();
    window.removeEventListener('storage', onStorage);
  };
}

export type SessionVerdict = 'same' | 'changed' | 'ended';

/**
 * Compara la sesión con la que se cargó la pestaña contra lo que dice `/api/auth/me` ahora.
 * `me === null` = la API contestó 401 (la sesión terminó). Si falta `sessionId` en alguno de los
 * dos lados (API vieja) solo se comparan usuario y empresa.
 */
export function judgeSession(
  loaded: LoadedSession,
  me: { userId?: string; accountId?: string; sessionId?: string } | null,
): SessionVerdict {
  if (!me) return 'ended';
  if (me.accountId && me.accountId !== loaded.accountId) return 'changed';
  if (loaded.userId && me.userId && me.userId !== loaded.userId) return 'changed';
  if (loaded.sessionId && me.sessionId && me.sessionId !== loaded.sessionId) return 'changed';
  return 'same';
}

/** Lee el `sessionId` de un access JWT (sin verificarlo: la firma la verifica la API). */
export function sessionIdFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sessionId?: unknown };
    return typeof json.sessionId === 'string' ? json.sessionId : null;
  } catch {
    return null;
  }
}
