import { NextResponse } from 'next/server';
import type { SessionInfo } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Lista las sesiones activas del usuario. */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<SessionInfo[]>('/auth/sessions', { method: 'GET', auth: true });
  if (status !== 200) return apiError(status, body);
  return NextResponse.json({ sessions: body.data ?? [] });
}

/** Cierra todas las sesiones excepto la actual. */
export async function DELETE(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  const { status, body } = await apiCall('/auth/sessions', { method: 'DELETE', auth: true });
  if (status !== 204 && status !== 200) return apiError(status, body);
  return new NextResponse(null, { status: 204 });
}
