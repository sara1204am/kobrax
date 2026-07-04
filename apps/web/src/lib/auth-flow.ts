import { NextResponse } from 'next/server';
import type { LoginResult } from '@kobrax/shared';
import { setAuthCookies, setPreAuthCookie, type ApiEnvelope } from './bff';

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
