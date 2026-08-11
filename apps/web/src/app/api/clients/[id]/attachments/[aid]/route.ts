import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string; aid: string };
}

/** Sacarle un adjunto al cliente. Responde 204, así que devuelve `{ok:true}` para que el cliente parsee. */
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { status, body } = await apiCall<null>(`/clients/${params.id}/attachments/${params.aid}`, {
    method: 'DELETE',
    auth: true,
  });
  if (status !== 204 && status !== 200) return apiError(status, body);

  return NextResponse.json({ ok: true });
}
