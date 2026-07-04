import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { LoginResult } from '@kobrax/shared';
import { apiCall, COOKIE, sameOrigin } from '@/lib/bff';
import { apiError, stepResponse } from '@/lib/auth-flow';

type Body = { action?: 'start' | 'verify'; code?: string };

/**
 * Setup MFA obligatorio durante el login (gated por el pre-auth token en cookie):
 * - `start`  → devuelve `{ otpauthUrl, secret }` para configurar el authenticator.
 * - `verify` → activa MFA, completa el login (setea cookies) y devuelve los backup codes.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const preAuthToken = cookies().get(COOKIE.preAuth)?.value;
  if (!preAuthToken) return NextResponse.json({ error: { code: 'AUTH_003', message: 'Sesión de login expirada' } }, { status: 401 });

  const { action, code } = (await req.json().catch(() => ({}))) as Body;

  if (action === 'start') {
    const { status, body } = await apiCall<{ otpauthUrl: string; secret: string }>('/auth/mfa/setup/start', {
      method: 'POST',
      body: JSON.stringify({ preAuthToken }),
    });
    if (status !== 200 || !body.data) return apiError(status, body);
    return NextResponse.json(body.data);
  }

  if (action === 'verify') {
    if (!code) return NextResponse.json({ error: { code: 'VALIDATION', message: 'Código requerido' } }, { status: 400 });
    const { status, body } = await apiCall<LoginResult & { backupCodes: string[] }>('/auth/mfa/setup/verify', {
      method: 'POST',
      body: JSON.stringify({ preAuthToken, code }),
    });
    if (status !== 200 || !body.data) return apiError(status, body);
    return stepResponse(body.data, { backupCodes: body.data.backupCodes });
  }

  return NextResponse.json({ error: { code: 'VALIDATION', message: 'Acción inválida' } }, { status: 400 });
}
