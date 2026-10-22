import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Pasa varias personas a la agencia en un solo paso. Quitar a una es `PATCH /api/users/:id` con `branchId: null`. */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<{ id: string }>(`/branches/${encodeURIComponent(params.id)}/members`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  if (status >= 300 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}
