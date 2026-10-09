import * as SecureStore from 'expo-secure-store';

/**
 * Lo que el flujo de acceso sin sesión debe sobrevivir cuando Android mata o recrea la app al
 * mandarla al fondo (M-FOR-29 / M-LOG-12): el correo tecleado en el login y el paso "Revisa tu
 * correo" de recuperar contraseña con su cuenta regresiva.
 *
 * Va a SecureStore (disco) y no a un `useState`/store en memoria: el caso que importa es que el
 * proceso muere y arranca de cero, y ahí la memoria no sirve. Nunca se guarda la contraseña.
 *
 * Todo lleva el instante en que se guardó y caduca (`DRAFT_TTL_MS`): un borrador viejo no debe
 * reaparecer días después. Es solo un límite técnico para que el dato no quede para siempre; la
 * política de inactividad de la sesión NO se toca aquí.
 */
const KEY = { loginEmail: 'k_draft_login_email', forgot: 'k_draft_forgot' } as const;

export const DRAFT_TTL_MS = 10 * 60 * 1000;
/** Espera entre un envío del enlace de recuperación y el siguiente que ofrece la pantalla. */
export const RESEND_SECONDS = 30;

/** Segundos que faltan para poder reenviar, desde el instante absoluto del envío. */
export function resendSecondsLeft(sentAt: number | null, now: number): number {
  if (sentAt == null) return 0;
  const left = Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000);
  return Math.min(RESEND_SECONDS, Math.max(0, left));
}

async function readJson<T extends { savedAt: number }>(key: string, now: number): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as T;
    if (typeof v?.savedAt !== 'number' || now - v.savedAt > DRAFT_TTL_MS) {
      await SecureStore.deleteItemAsync(key);
      return null;
    }
    return v;
  } catch {
    return null; // un borrador ilegible es un borrador que no hay
  }
}

async function writeJson(key: string, value: object): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    /* sin borrador no se rompe nada: es una comodidad */
  }
}

async function remove(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* idem */
  }
}

// ── Correo del login ──────────────────────────────────────────────────────────
export const saveLoginEmail = (email: string, now = Date.now()) =>
  email ? writeJson(KEY.loginEmail, { email, savedAt: now }) : remove(KEY.loginEmail);

export async function loadLoginEmail(now = Date.now()): Promise<string | null> {
  return (await readJson<{ email: string; savedAt: number }>(KEY.loginEmail, now))?.email ?? null;
}

export const clearLoginEmail = () => remove(KEY.loginEmail);

// ── Recuperar contraseña ──────────────────────────────────────────────────────
export interface ForgotDraft {
  email: string;
  /** Instante absoluto (ms) del último envío; `null` si todavía no se envió (solo escribió el correo). */
  sentAt: number | null;
  savedAt: number;
}

export const saveForgotDraft = (email: string, sentAt: number | null, now = Date.now()) =>
  writeJson(KEY.forgot, { email, sentAt, savedAt: now } satisfies ForgotDraft);

export const loadForgotDraft = (now = Date.now()) => readJson<ForgotDraft>(KEY.forgot, now);

export const clearForgotDraft = () => remove(KEY.forgot);
