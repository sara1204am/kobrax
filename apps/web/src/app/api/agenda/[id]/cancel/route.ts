import type { NextResponse } from 'next/server';
import type { AgendaListItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Cancelar la gestión con un motivo del catálogo (`agenda:write`).
 *
 * **Sigue visible en su día**, con el estado Cancelada: si desapareciera, cancelar sería
 * indistinguible de eliminar y el día dejaría de contar lo que pasó de verdad.
 */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<AgendaListItem>(req, `/agenda/${params.id}/cancel`);
}
