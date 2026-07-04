import { NextResponse } from 'next/server';
import type { LoginResult } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError, stepResponse } from '@/lib/auth-flow';

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Email y contraseña requeridos' } }, { status: 400 });
  }

  const { status, body } = await apiCall<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return stepResponse(body.data);
}
