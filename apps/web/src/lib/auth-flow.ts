import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { LoginResult } from '@kobrax/shared';
import { apiCall, COOKIE, setAuthCookies, setPreAuthCookie, type ApiEnvelope } from './bff';

/**
 * Traduce un `LoginResult` del backend a una respuesta del BFF:
 * - `done`  → setea cookies de tokens y responde `{ step:'done' }`.
 * - otros   → guarda el pre-auth token en cookie httpOnly y responde el paso
 *             (+ `accounts` para el selector). El token nunca llega al navegador.
 */
export function stepResponse(data: LoginResult, extra: Record<string, unknown> = {}): NextResponse {
  if (data.step === 'done' && data.accessToken && data.refreshToken) {
    const res = NextResponse.json({ step: 'done', ...extra });
    setAuthCookies(res, { accessToken: data.accessToken, refreshToken: data.refreshToken });
    return res;
  }
  const res = NextResponse.json({ step: data.step, accounts: data.accounts ?? null, ...extra });
  if (data.preAuthToken) setPreAuthCookie(res, data.preAuthToken);
  return res;
}

/** Propaga el error del backend (code/message) con su status. */
export function apiError(status: number, body: ApiEnvelope<unknown>): NextResponse {
  return NextResponse.json(
    { error: body.error ?? { code: 'ERR', message: 'Error inesperado' } },
    { status: status >= 400 ? status : 400 },
  );
}

/**
 * Defensa extra de W-LOG-54: si un login/alta/invitación llega con las cookies de **otra** sesión
 * (una pestaña que ya estaba abierta en el formulario), esa sesión se revoca en el servidor antes
 * de que las cookies se pisen. Sin esto quedaba activa hasta 7 días sin que nadie la usara.
 *
 * Se llama **después** de que la API aceptó la operación nueva: un login con la contraseña mal
 * escrita no tiene por qué cerrar la sesión de otra persona. Best-effort, como el logout.
 * Devuelve `true` si había una sesión previa (para limpiar sus cookies cuando no se pisan).
 */
export async function revokePreviousSession(): Promise<boolean> {
  const refreshToken = cookies().get(COOKIE.refresh)?.value;
  if (!refreshToken) return false;
  await apiCall('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
  return true;
}
