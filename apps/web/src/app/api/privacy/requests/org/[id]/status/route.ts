import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

const UUID = /^[0-9a-fA-F-]{36}$/;

/** Cambia el estado de una solicitud de la organización → `PATCH /privacy/requests/org/:id/status`. Rechazar exige justificación (lo valida la API). */
export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  if (!UUID.test(params.id)) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Solicitud no válida' } }, { status: 400 });
  }
  const parsed = (await req.json().catch(() => null)) as { status?: string; note?: string; rejectionReason?: string } | null;
  const { status, body } = await apiCall<unknown>(`/privacy/requests/org/${params.id}/status`, {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify({ status: parsed?.status, note: parsed?.note, rejectionReason: parsed?.rejectionReason }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
