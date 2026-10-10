import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/** Aprobar, rechazar o retirar un pedido de cambio. Solo quien armó la ruta resuelve; quien pidió, retira. */
export async function PATCH(req: Request, { params }: { params: { id: string; rid: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/routes/${params.id}/change-requests/${params.rid}`, 'PATCH');
}
