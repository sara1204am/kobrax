import { NextResponse } from 'next/server';
import type { CreditNote } from '@kobrax/shared';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

/**
 * Escribir una nota sobre un crédito (`case:write`). El cuerpo es `{ kind?, body }`.
 *
 * 🔴 El `creditId` de la ruta se valida como uuid **antes** de armar la URL de la API: viaja dentro del path, y
 * un valor como `../cases` apuntaría el POST a otro endpoint. Lo demás (largo, tipo, alcance) lo valida la API.
 */
export async function POST(req: Request, { params }: { params: { creditId: string } }): Promise<NextResponse> {
  if (!isUuid(params.creditId)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Crédito no encontrado' } }, { status: 404 });
  }
  return proxyMutation<CreditNote>(req, `/mora/${params.creditId}/notes`);
}
