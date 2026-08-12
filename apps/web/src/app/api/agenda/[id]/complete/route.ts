import type { NextResponse } from 'next/server';
import type { AgendaListItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Registrar que la gestión se ejecutó (`agenda:write`).
 *
 * Deja un `CaseActivity` en el historial del caso y pasa el ítem a `EXECUTED`: completar una
 * gestión **escribe en dos lados**, y por eso la ficha del caso cambia sin que nadie la toque.
 */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<AgendaListItem>(req, `/agenda/${params.id}/complete`);
}
