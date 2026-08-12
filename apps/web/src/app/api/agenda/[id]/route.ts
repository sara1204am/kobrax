import type { NextResponse } from 'next/server';
import type { AgendaListItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Editar una gestión pendiente (`agenda:write`).
 *
 * **Sin fecha ni deudor**: mover el día es reagendar —que deja rastro en el día viejo— y el deudor
 * es el ancla del agendado. El servidor ni siquiera los acepta; `buildAgendaPatch` de `shared` ya
 * los deja afuera del cuerpo.
 */
export function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<AgendaListItem>(req, `/agenda/${params.id}`, 'PATCH');
}
