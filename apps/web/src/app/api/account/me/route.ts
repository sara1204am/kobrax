import { NextResponse } from 'next/server';
import type { AccountInfo, AccountPatch } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Datos del negocio. El cuerpo se pasa tal cual: **es un parche**, no el objeto entero.
 * La API corre con `forbidNonWhitelisted: true`, así que un campo de más es un 400 — el
 * recorte lo hace `diffAccount` de `shared`, en la pantalla.
 */
export async function PATCH(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const patch = (await req.json().catch(() => ({}))) as AccountPatch;
  const { status, body } = await apiCall<AccountInfo>('/accounts/me', {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(patch),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
