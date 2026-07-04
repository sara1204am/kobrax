import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { LoginResult } from '@kobrax/shared';
import { apiCall, COOKIE, sameOrigin } from '@/lib/bff';
import { apiError, stepResponse } from '@/lib/auth-flow';

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const preAuthToken = cookies().get(COOKIE.preAuth)?.value;
  if (!preAuthToken) return NextResponse.json({ error: { code: 'AUTH_003', message: 'Sesión de login expirada' } }, { status: 401 });

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code) return NextResponse.json({ error: { code: 'VALIDATION', message: 'Código requerido' } }, { status: 400 });

  const { status, body } = await apiCall<LoginResult>('/auth/mfa/challenge', {
    method: 'POST',
    body: JSON.stringify({ preAuthToken, code }),
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return stepResponse(body.data);
}
