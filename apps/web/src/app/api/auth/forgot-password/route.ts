import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';

/** Recuperación: respuesta 200 genérica (anti-enumeration) pase lo que pase. */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (email) {
    await apiCall('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}
