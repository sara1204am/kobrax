import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Las solicitudes de titulares de cobranza de la organización → `GET /privacy/requests/org` (pide `account:write`, lo valida la API). */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<unknown[]>('/privacy/requests/org', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}

/** Registra la solicitud de un titular de cobranza → `POST /privacy/requests/org`. */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const parsed = (await req.json().catch(() => null)) as { type?: string; subjectLabel?: string; description?: string } | null;
  const { status, body } = await apiCall<unknown>('/privacy/requests/org', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ type: parsed?.type, subjectLabel: parsed?.subjectLabel, description: parsed?.description }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { status: 201 });
}
