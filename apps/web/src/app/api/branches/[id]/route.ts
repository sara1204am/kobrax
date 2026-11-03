import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

const csrf = () => NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

/** Editar una agencia (nombre, código, responsable, activa…). El cuerpo es un parche. */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) return csrf();
  const { status, body } = await apiCall<{ id: string }>(`/branches/${encodeURIComponent(params.id)}`, {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  if (status >= 300 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}

/** Baja lógica. La API la rechaza (409) mientras la agencia tenga miembros activos. */
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) return csrf();
  const { status, body } = await apiCall<null>(`/branches/${encodeURIComponent(params.id)}`, { method: 'DELETE', auth: true });
  if (status >= 300) return apiError(status, body);

  return NextResponse.json({ data: null });
}
