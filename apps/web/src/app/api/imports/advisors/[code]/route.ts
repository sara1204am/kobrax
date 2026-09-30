import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { code: string };
}

const csrf = () => NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

/** Vincula un código de asesor a un usuario (D8). El servidor valida el código y que el usuario sea de la empresa. */
export async function PUT(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) return csrf();
  const dto = (await req.json().catch(() => ({}))) as { userId?: string };
  const { status, body } = await apiCall<{ advisorCode: string; userId: string }>(
    `/imports/portfolio/advisors/${encodeURIComponent(params.code)}`,
    { method: 'PUT', auth: true, body: JSON.stringify({ userId: dto.userId }) },
  );
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}

export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) return csrf();
  const { status, body } = await apiCall<{ advisorCode: string }>(`/imports/portfolio/advisors/${encodeURIComponent(params.code)}`, {
    method: 'DELETE',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
