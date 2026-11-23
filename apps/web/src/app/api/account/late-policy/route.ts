import { NextResponse } from 'next/server';
import type { LatePolicyInfo, LatePolicyInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Política de interés moratorio de la cuenta. Cada guardado crea una VERSIÓN nueva en la API (nunca edita una anterior);
 * acá solo se reenvía el cuerpo y se devuelve la política que quedó vigente.
 */
export async function PUT(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const input = (await req.json().catch(() => ({}))) as LatePolicyInput;
  const { status, body } = await apiCall<LatePolicyInfo>('/accounts/me/late-policy', {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(input),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
