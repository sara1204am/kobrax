import { NextResponse } from 'next/server';
import type { InvitedMember } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Invitar a alguien al equipo.
 *
 * La respuesta trae el `invitationCode` **una sola vez**: el correo se manda después del
 * commit y sin esperarlo (unos 3,4 s de SMTP), así que la invitación ya existe aunque el
 * correo falle. Por eso el código se le muestra a quien invita en vez de quedar sólo en un
 * mail que puede caer en spam.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { status, body: res } = await apiCall<InvitedMember>('/users/invite', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(body),
  });
  if (status !== 200 && status !== 201) return apiError(status, res);
  if (!res.data) return apiError(status, res);

  return NextResponse.json(res.data);
}
