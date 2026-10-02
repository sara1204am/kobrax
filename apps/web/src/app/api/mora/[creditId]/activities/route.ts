import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

/**
 * Registrar una gestión sobre un crédito, con su resultado y su promesa (`case:write`).
 *
 * El cuerpo es `{ type, result?, notes?, promise? }`. La API aplica la regla (qué resultado corresponde a qué tipo,
 * promesa y resultado juntos) y, si el crédito no tiene caso, lo abre.
 *
 * 🔴 El `creditId` se valida como uuid **antes** de armar la URL: viaja dentro del path, y un valor como
 * `../cases` apuntaría el POST a otro endpoint.
 */
export async function POST(req: Request, { params }: { params: { creditId: string } }): Promise<NextResponse> {
  if (!isUuid(params.creditId)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Crédito no encontrado' } }, { status: 404 });
  }
  return proxyMutation<unknown>(req, `/mora/${params.creditId}/activities`);
}
