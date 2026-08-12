import type { NextResponse } from 'next/server';
import type { CaseListItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Mover el caso de estado (`case:write`).
 *
 * La pantalla ofrece **sólo las transiciones válidas** desde el estado actual (`CASE_TRANSITIONS`
 * de `shared`), pero el freno de verdad es el del servidor: rechaza el salto con `CASE_002`.
 *
 * Cerrar **no pasa por acá**: tiene su propio endpoint, exige motivo y otro permiso.
 */
export function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<CaseListItem>(req, `/cases/${params.id}`, 'PATCH');
}
