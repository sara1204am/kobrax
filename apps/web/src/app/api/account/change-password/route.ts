import { NextResponse } from 'next/server';
import { apiCall, clearAuthCookies, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Cambia la contraseña. El backend revoca TODAS las sesiones → limpiamos cookies (re-login). */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const { currentPassword, newPassword } = (await req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Contraseña actual y nueva requeridas' } }, { status: 400 });
  }

  const { status, body } = await apiCall('/auth/change-password', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (status !== 200) return apiError(status, body);

  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res); // la sesión actual quedó revocada en el backend
  return res;
}
