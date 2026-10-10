import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/** Adjuntar la evidencia (foto) a una visita ya registrada. El hash lo calculó `/api/uploads` sobre el archivo original. */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/visits/${params.id}/evidence`);
}
