import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Las solicitudes de derechos de la propia persona → `GET /privacy/requests/mine`. La persona sale de la sesión. */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<unknown[]>('/privacy/requests/mine', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}

/** Presenta una solicitud sobre SUS datos → `POST /privacy/requests`. Se nombran los campos uno por uno: lo demás se descarta. */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const parsed = (await req.json().catch(() => null)) as { type?: string; description?: string } | null;
  const { status, body } = await apiCall<unknown>('/privacy/requests', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ type: parsed?.type, description: parsed?.description }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { status: 201 });
}
