import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Un ítem de catálogo: editar y quitar (soft-delete). `catalog:write` lo valida la API. */
export async function PATCH(
  req: Request,
  { params }: { params: { type: string; id: string } },
): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<{ id: string }>(
    `/catalogs/${encodeURIComponent(params.type)}/${encodeURIComponent(params.id)}`,
    { method: 'PATCH', auth: true, body: JSON.stringify(await req.json().catch(() => ({}))) },
  );
  if (status >= 300 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}

export async function DELETE(
  req: Request,
  { params }: { params: { type: string; id: string } },
): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<null>(
    `/catalogs/${encodeURIComponent(params.type)}/${encodeURIComponent(params.id)}`,
    { method: 'DELETE', auth: true },
  );
  if (status >= 300) return apiError(status, body);

  return NextResponse.json({ data: null });
}
