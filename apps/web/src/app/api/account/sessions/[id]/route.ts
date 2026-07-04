import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Cierra una sesión concreta del usuario. */
export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  const { status, body } = await apiCall(`/auth/sessions/${params.id}`, { method: 'DELETE', auth: true });
  if (status !== 204 && status !== 200) return apiError(status, body);
  return new NextResponse(null, { status: 204 });
}
