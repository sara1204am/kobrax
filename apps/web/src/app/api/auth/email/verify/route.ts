import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * La persona confirma que el correo de su cuenta es suyo → `POST /auth/email/verify`. Sin sesión: el enlace del correo es la prueba. Va por POST
 * (lo dispara un botón en `/verificar-correo`) y no por GET: los escáneres de enlaces del correo abren los GET solos y confirmarían sin que
 * nadie lo pida.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const p = (await req.json().catch(() => null)) as { token?: string } | null;
  const { status, body } = await apiCall<{ verified: boolean }>('/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify({ token: p?.token }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
