import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiCall, COOKIE, clearAuthCookies, sameOrigin } from '@/lib/bff';

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const refreshToken = cookies().get(COOKIE.refresh)?.value;
  if (refreshToken) {
    // Revoca refresh + sesión + denylist en el backend (best-effort).
    await apiCall('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
