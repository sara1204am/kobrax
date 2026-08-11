import { NextResponse } from 'next/server';
import type { InvitedMember } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Reenviar una invitación. Devuelve un código **nuevo** e invalida el anterior: la API deja
 * un solo código vigente por persona. Quien reenvía tiene que saberlo, o manda dos y el
 * primero ya no sirve.
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { status, body } = await apiCall<InvitedMember>(`/users/${params.id}/invite/resend`, {
    method: 'POST',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
