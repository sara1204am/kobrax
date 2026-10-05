import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

/**
 * Fijar la prioridad del episodio de mora abierto (`{ priority: 'HIGH' }`) o soltarla (`{ priority: null }`).
 * `collection:write`. El `creditId` se valida como uuid antes de armar la URL (viaja dentro del path).
 */
export async function PATCH(req: Request, { params }: { params: { creditId: string } }): Promise<NextResponse> {
  if (!isUuid(params.creditId)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Crédito no encontrado' } }, { status: 404 });
  }
  return proxyMutation<unknown>(req, `/mora/${params.creditId}/priority`, 'PATCH');
}
