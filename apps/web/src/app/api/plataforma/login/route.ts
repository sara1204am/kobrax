import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import { setPlatformCookie } from '@/lib/platform-bff';

/**
 * Inicio de sesión de la persona de plataforma → `POST /platform/auth/login`. Exige correo, contraseña y código del MFA.
 *
 * El primer ingreso (enrolar el MFA) NO se hace desde la web: necesita la clave de enrolamiento que solo tiene quien opera el servidor, y aquí
 * nunca se envía. Si la API responde `mfa_setup`, se dice que el acceso no está listo, sin entregar el secreto.
 * Los fallos de credenciales son una sola respuesta genérica (lo decide la API).
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  const p = (await req.json().catch(() => null)) as { email?: string; password?: string; code?: string } | null;
  const { status, body } = await apiCall<{ step: string; accessToken?: string }>('/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: p?.email, password: p?.password, code: p?.code }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  if (body.data.step !== 'done' || !body.data.accessToken) {
    return NextResponse.json({ error: { code: 'PLATFORM_MFA_NOT_READY', message: 'El acceso de esta persona todavía no está habilitado' } }, { status: 403 });
  }
  const res = NextResponse.json({ step: 'done' });
  setPlatformCookie(res, body.data.accessToken);
  return res;
}
