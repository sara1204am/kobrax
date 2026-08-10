import { NextResponse } from 'next/server';
import type { MyProfile, ProfilePatch } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Mi perfil. El cuerpo es un parche armado por `diffProfile` de `shared`, que además traduce
 * «vaciar el QR» a `null` — para el servidor, `null` (borrarlo) y ausente (no tocarlo) son
 * cosas distintas.
 */
export async function PATCH(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const patch = (await req.json().catch(() => ({}))) as ProfilePatch;
  const { status, body } = await apiCall<MyProfile>('/users/me/profile', {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(patch),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
