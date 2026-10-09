import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/** Pedir un cambio sobre una ruta que armó otra persona: tipo, lo que se pide y el motivo (F4/12). */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/routes/${params.id}/change-requests`);
}
