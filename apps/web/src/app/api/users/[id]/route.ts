import { NextResponse } from 'next/server';
import type { Member } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/** Cambiar el rol o activar/desactivar a un miembro. */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const patch = (await req.json().catch(() => ({}))) as { roleId?: string; isActive?: boolean };
  const { status, body } = await apiCall<Member>(`/users/${params.id}`, {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(patch),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}

/**
 * Cancelar una invitación. La API sólo borra **pendientes** (`notPending`): a quien ya
 * trabajó se lo desactiva con el `PATCH` de arriba, para no dejar huérfanos sus casos y pagos.
 *
 * Responde 204 sin cuerpo, así que acá se devuelve un `{ ok: true }` — el cliente hace
 * `res.json()` y un 204 lo dejaría con un cuerpo vacío que no parsea.
 */
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { status, body } = await apiCall<null>(`/users/${params.id}`, { method: 'DELETE', auth: true });
  if (status !== 204 && status !== 200) return apiError(status, body);

  return NextResponse.json({ ok: true });
}
