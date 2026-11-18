import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Pide otro enlace de confirmación del correo → `POST /auth/email/resend`. Con sesión (el aviso del panel). */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<{ sent: boolean }>('/auth/email/resend', { method: 'POST', auth: true });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
