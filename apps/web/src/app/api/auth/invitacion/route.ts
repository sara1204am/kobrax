import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Aceptar la invitación → `POST /auth/invitation/accept`. Fija la contraseña y activa al usuario.
 *
 * El código va en el **body** y no en la URL (a diferencia del GET de al lado): así no queda
 * escrito en los access logs de nadie. Es la misma decisión que tomó la API.
 *
 * Tampoco setea cookies: igual que el registro, no devuelve tokens (S2-D8). La pantalla hace el
 * login normal después.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { code, password } = (await req.json().catch(() => ({}))) as { code?: string; password?: string };
  if (!code || !password) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Faltan datos' } }, { status: 400 });
  }

  const { status, body } = await apiCall<{ email: string }>('/auth/invitation/accept', {
    method: 'POST',
    body: JSON.stringify({ code, password }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
