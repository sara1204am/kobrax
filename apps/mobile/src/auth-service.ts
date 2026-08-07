import type { AuthAccountOption, AuthTokens, LoginResult } from '@kobrax/shared';
import { apiFetch, type ApiResult } from './api';
import { authedFetch } from './api-client';
import { clearSession, getSession, isSessionValid, saveSession, saveUserId, touchSession } from './session';
import * as db from './db';

export type Step = 'done' | 'mfa' | 'mfa_setup' | 'select_account';

export interface Me {
  userId: string;
  email: string;
  profile: { firstName: string; lastName: string; photoUrl?: string } | null;
  accountId: string;
  role: string;
  permissions: string[];
  /** El usuario ya tiene MFA enrolado (lo necesita la UI de seguridad). */
  mfaEnabled: boolean;
  /** El backend exige cambiar la contraseña antes de operar (cambio forzado). */
  requiresPasswordChange: boolean;
}

/**
 * Resultado de `me()`. Distingue el fallo de red (status 0) del de auth (401 sin refresh)
 * para que el bootstrap pueda entrar en **modo offline** con la sesión local vigente
 * (EPIC-F2b historia 14) en lugar de mandar siempre al login.
 */
export type MeResult =
  | { status: 'ok'; me: Me }
  | { status: 'offline' }
  | { status: 'unauthenticated' };

/**
 * Estado del flujo de login (en memoria; el pre-auth token es efímero, 5 min).
 * Vive solo entre pasos; se limpia al completar o reiniciar el login.
 */
const flow: { preAuthToken: string | null; accounts: AuthAccountOption[] } = {
  preAuthToken: null,
  accounts: [],
};

export function getFlowAccounts(): AuthAccountOption[] {
  return flow.accounts;
}

function resetFlow(): void {
  flow.preAuthToken = null;
  flow.accounts = [];
}

/** Traduce un LoginResult: si es `done` guarda la sesión; si no, retiene el pre-auth. */
async function handleResult(data: LoginResult): Promise<Step> {
  if (data.step === 'done' && data.accessToken && data.refreshToken) {
    await saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    resetFlow();
    return 'done';
  }
  if (data.preAuthToken) flow.preAuthToken = data.preAuthToken;
  flow.accounts = data.accounts ?? [];
  return data.step as Step;
}

/** Convierte un error de la API en un mensaje legible. */
function errMessage(res: ApiResult<unknown>): string {
  return res.error?.message ?? 'Ocurrió un error, intenta de nuevo';
}

/**
 * El último `me` guardado, si la sesión offline sigue vigente. `null` si nunca hubo uno o si la
 * ventana venció — ahí sí corresponde mandar a la pantalla de sin conexión, porque ya no se puede
 * confiar en una identidad vieja.
 *
 * `ponytail:` no se re-valida nada contra el token. La ventana de 8 h de `session.ts` ya es la
 * regla de cuánto vale una sesión sin poder preguntarle al servidor; agregar una segunda sería
 * tener dos relojes que se contradicen.
 */
async function meLocal(): Promise<MeResult | null> {
  if (!isSessionValid(await getSession())) return null;
  const me = await db.getOne<Me>('session', 'me');
  return me ? { status: 'ok', me } : null;
}

export const authService = {
  async login(email: string, password: string): Promise<{ step: Step } | { error: string }> {
    const res = await apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { email, password } });
    if (res.status !== 200 || !res.data) return { error: errMessage(res) };
    return { step: await handleResult(res.data) };
  },

  async mfaChallenge(code: string): Promise<{ step: Step } | { error: string }> {
    if (!flow.preAuthToken) return { error: 'Sesión de login expirada' };
    const res = await apiFetch<LoginResult>('/auth/mfa/challenge', {
      method: 'POST',
      body: { preAuthToken: flow.preAuthToken, code },
    });
    if (res.status !== 200 || !res.data) return { error: errMessage(res) };
    return { step: await handleResult(res.data) };
  },

  async mfaSetupStart(): Promise<{ otpauthUrl: string; secret: string } | { error: string }> {
    if (!flow.preAuthToken) return { error: 'Sesión de login expirada' };
    const res = await apiFetch<{ otpauthUrl: string; secret: string }>('/auth/mfa/setup/start', {
      method: 'POST',
      body: { preAuthToken: flow.preAuthToken },
    });
    if (res.status !== 200 || !res.data) return { error: errMessage(res) };
    return res.data;
  },

  async mfaSetupVerify(code: string): Promise<{ step: Step; backupCodes: string[] } | { error: string }> {
    if (!flow.preAuthToken) return { error: 'Sesión de login expirada' };
    const res = await apiFetch<LoginResult & { backupCodes: string[] }>('/auth/mfa/setup/verify', {
      method: 'POST',
      body: { preAuthToken: flow.preAuthToken, code },
    });
    if (res.status !== 200 || !res.data) return { error: errMessage(res) };
    const backupCodes = res.data.backupCodes;
    const step = await handleResult(res.data);
    return { step, backupCodes };
  },

  /** "Lo hago después": entra sin activar MFA. El recordatorio queda en el Home. */
  async mfaSetupSkip(): Promise<{ step: Step } | { error: string }> {
    if (!flow.preAuthToken) return { error: 'Sesión de login expirada' };
    const res = await apiFetch<LoginResult>('/auth/mfa/setup/skip', {
      method: 'POST',
      body: { preAuthToken: flow.preAuthToken },
    });
    if (res.status !== 200 || !res.data) return { error: errMessage(res) };
    return { step: await handleResult(res.data) };
  },

  /**
   * Enrolar MFA **ya con sesión** (desde el aviso del Home, no durante el login).
   * Son los endpoints self-service que ya existían; acá sólo se les pone el envoltorio.
   */
  async mfaEnroll(): Promise<{ otpauthUrl: string; secret: string } | { error: string }> {
    const res = await authedFetch<{ otpauthUrl: string; secret: string }>('/auth/mfa/enroll', {
      method: 'POST',
    });
    if (res.status !== 200 || !res.data) return { error: errMessage(res as ApiResult<unknown>) };
    return res.data;
  },

  async mfaVerify(code: string): Promise<{ backupCodes: string[] } | { error: string }> {
    const res = await authedFetch<{ enabled: true; backupCodes: string[] }>('/auth/mfa/verify', {
      method: 'POST',
      body: { code },
    });
    if (res.status !== 200 || !res.data) return { error: errMessage(res as ApiResult<unknown>) };
    return { backupCodes: res.data.backupCodes };
  },

  async selectAccount(accountId: string): Promise<{ step: Step } | { error: string }> {
    if (!flow.preAuthToken) return { error: 'Sesión de login expirada' };
    const res = await apiFetch<AuthTokens>('/auth/select-account', {
      method: 'POST',
      body: { preAuthToken: flow.preAuthToken, accountId },
    });
    if (res.status !== 200 || !res.data) return { error: errMessage(res) };
    await saveSession(res.data);
    resetFlow();
    return { step: 'done' };
  },

  /**
   * Datos de la sesión actual; refresca el access una vez si expiró (401).
   * Devuelve `offline` ante fallo de red (no toca la sesión local) y `unauthenticated`
   * solo cuando el refresh fue rechazado por el servidor.
   */
  async me(): Promise<MeResult> {
    const res = await authedFetch<Me>('/auth/me');
    if (res.status === 'unauthenticated') return { status: 'unauthenticated' };
    // Sin red: si la sesión local sigue vigente, se responde con el último `me` guardado. Es lo que
    // permite ABRIR la app sin señal y llegar a los datos locales (P6 · riesgo R3 del plan). Antes,
    // el arranque moría en la pantalla de offline aunque el teléfono tuviera la jornada entera
    // guardada — que es el caso normal del cobrador que sale a la calle.
    if (res.status === 0) return (await meLocal()) ?? { status: 'offline' };
    if (res.status === 200 && res.data) {
      await touchSession(); // actividad → extiende la ventana de inactividad (8h)
      // Quién es, para poder encolar acciones cuando no haya red y no se le pueda preguntar (P6).
      await saveUserId(res.data.userId);
      await db.putOne('session', 'me', res.data);
      return { status: 'ok', me: res.data };
    }
    // Solo un 401 puede venir de "se cayó la red durante el refresh" (sesión intacta) → offline.
    // Cualquier otro no-200 (403/500) es fallo server-side, no de red → re-login, no varar en offline.
    if (res.status === 401 && (await getSession())) return (await meLocal()) ?? { status: 'offline' };
    return { status: 'unauthenticated' };
  },

  /** Solicita el correo de recuperación. La API responde 200 siempre (anti-enumeration). */
  async forgotPassword(email: string): Promise<{ ok: true } | { error: string }> {
    const res = await apiFetch<{ ok: true }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
    if (res.status === 0) return { error: 'Sin conexión. Revisa tu red e intenta de nuevo.' };
    if (res.status === 429) return { error: 'Demasiados intentos. Espera una hora antes de reintentar.' };
    if (res.status !== 200) return { error: errMessage(res) };
    return { ok: true };
  },

  /**
   * Cambia la contraseña (Bearer). El backend **revoca todas las sesiones** al cambiar,
   * por eso al terminar limpiamos la sesión local y forzamos re-login.
   */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true } | { error: string }> {
    const res = await authedFetch('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    if (res.status === 'unauthenticated') return { error: 'Sesión expirada' };
    if (res.status === 0) return { error: 'Sin conexión. Revisa tu red e intenta de nuevo.' };
    if (res.status !== 200) return { error: errMessage(res) };
    await clearSession(); // sesiones revocadas server-side → re-login
    return { ok: true };
  },

  async logout(): Promise<void> {
    const session = await getSession();
    if (session) {
      await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken: session.refreshToken } });
    }
    await clearSession();
  },
};
