import { NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import { platformCall } from '@/lib/platform-bff';
import { isUuid } from '@/lib/uuid';

/** Cambia el estado de una solicitud o reporte → `PATCH /platform/privacy-requests/:id/status`. Se nombran los campos uno por uno. */
export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontrado' } }, { status: 404 });
  const p = (await req.json().catch(() => null)) as { status?: string; note?: string; rejectionReason?: string } | null;
  const { status, body } = await platformCall<unknown>(`/platform/privacy-requests/${params.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: p?.status, note: p?.note || undefined, rejectionReason: p?.rejectionReason || undefined }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
