import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

/**
 * Quién responde por el crédito (`{ payerParty: 'HOLDER' | … }`, o `null` para borrarlo). Es un dato del crédito: se corrige desde su card.
 * `collection:write`. El `creditId` se valida como uuid antes de armar la URL (viaja dentro del path).
 */
export async function PATCH(req: Request, { params }: { params: { creditId: string } }): Promise<NextResponse> {
  if (!isUuid(params.creditId)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Crédito no encontrado' } }, { status: 404 });
  }
  return proxyMutation<unknown>(req, `/mora/${params.creditId}/payer`, 'PATCH');
}
