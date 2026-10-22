import { NextResponse } from 'next/server';
import type { AccountRequestInfo } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Un pedido de la cuenta a Kobrax (cambio de plan, baja). No cambia nada por sí solo: queda registrado y se avisa al
 * equipo. `account:write` y las demás reglas las valida la API.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<AccountRequestInfo>('/accounts/me/requests', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  if (status >= 300 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
