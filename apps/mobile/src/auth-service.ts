import type { AuthAccountOption, AuthTokens, LoginResult } from '@kobrax/shared';
import { apiFetch, type ApiResult } from './api';
import { authedFetch } from './api-client';
import { clearSession, getSession, saveSession, touchSession } from './session';

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
    if (res.status === 0) return { status: 'offline' };
    if (res.status === 200 && res.data) {
      await touchSession(); // actividad → extiende la ventana de inactividad (8h)
      return { status: 'ok', me: res.data };
    }
    // Solo un 401 puede venir de "se cayó la red durante el refresh" (sesión intacta) → offline.
    // Cualquier otro no-200 (403/500) es fallo server-side, no de red → re-login, no varar en offline.
    if (res.status === 401 && (await getSession())) return { status: 'offline' };
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
