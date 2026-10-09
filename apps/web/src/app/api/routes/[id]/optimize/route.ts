import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Aplicar el orden sugerido por la vista previa (F4/12). Sin cuerpo: la API recalcula y reordena; las paradas con hora
 * fija y las ya gestionadas conservan su lugar.
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/routes/${params.id}/optimize`);
}
