import type { NextResponse } from 'next/server';
import type { AgendaListItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Reagendar la gestión a otro día (`agenda:write`).
 *
 * ⚠️ **Devuelve la gestión NUEVA, no la que se reagendó.** La vieja queda cerrada como Reagendada
 * y sigue visible en su día —el día deja rastro—, y la nueva nace con `rescheduledFromId`
 * apuntando a ella. Refrescar con este id creyendo que es la misma deja la pantalla mostrando otra
 * cosa.
 */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<AgendaListItem>(req, `/agenda/${params.id}/reschedule`);
}
