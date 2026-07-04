import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const { token, newPassword } = (await req.json().catch(() => ({}))) as { token?: string; newPassword?: string };
  if (!token || !newPassword) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Token y contraseña requeridos' } }, { status: 400 });
  }

  const { status, body } = await apiCall('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
  if (status !== 200) return apiError(status, body);
  return NextResponse.json({ ok: true });
}
