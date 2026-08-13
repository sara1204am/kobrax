import type { NextResponse } from 'next/server';
import type { DashboardDefinition } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/** Guardar el tablero: nombre, predeterminado **y el layout entero** en una sola llamada. */
export function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<DashboardDefinition>(req, `/dashboards/${params.id}`, 'PATCH');
}

/**
 * Borrarlo. Es borrado suave del lado de la API, pero para quien mira **desaparece**: por eso la
 * pantalla pregunta antes.
 */
export function DELETE(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<{ id: string }>(req, `/dashboards/${params.id}`, 'DELETE');
}
