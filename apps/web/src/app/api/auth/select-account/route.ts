import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { AuthTokens } from '@kobrax/shared';
import { apiCall, COOKIE, sameOrigin, setAuthCookies } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const preAuthToken = cookies().get(COOKIE.preAuth)?.value;
  if (!preAuthToken) return NextResponse.json({ error: { code: 'AUTH_003', message: 'Sesión de login expirada' } }, { status: 401 });

  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: string };
  if (!accountId) return NextResponse.json({ error: { code: 'VALIDATION', message: 'Empresa requerida' } }, { status: 400 });

  const { status, body } = await apiCall<AuthTokens>('/auth/select-account', {
    method: 'POST',
    body: JSON.stringify({ preAuthToken, accountId }),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  const res = NextResponse.json({ step: 'done' });
  setAuthCookies(res, body.data);
  return res;
}
