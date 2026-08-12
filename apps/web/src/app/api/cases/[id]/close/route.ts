import type { NextResponse } from 'next/server';
import type { CaseListItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Cerrar el caso (`case:close`, un permiso aparte del de mover estados).
 *
 * El motivo es **obligatorio**, y la API no cierra un caso sin ninguna gestión registrada
 * (`CASE_001`): un caso que se cierra sin que nadie haya hecho nada no cuenta como cobrado.
 */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<CaseListItem>(req, `/cases/${params.id}/close`);
}
