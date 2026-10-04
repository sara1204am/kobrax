import { NextResponse } from 'next/server';
import type { CreditDetail } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * «Vincular a otro cliente» (D2): el mismo crédito —con sus casos, agenda y cobros— pasa al cliente
 * elegido, y la decisión queda guardada para las próximas importaciones. La valida el servidor.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = (await req.json().catch(() => ({}))) as { clientId?: string };
  const { status, body } = await apiCall<CreditDetail>(`/credits/${params.id}/link-client`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ clientId: dto.clientId }),
  });
  if (status !== 200 && status !== 201) return apiError(status, body);

  return NextResponse.json(body.data);
}
