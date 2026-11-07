import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders } from '@/lib/bff';

/**
 * F14 · F4: pedir un enlace temporal (5 minutos) para abrir un archivo SIN sesión —una pestaña nueva, algo que se comparte un momento—.
 * La API sólo lo da a quien ya puede leer el archivo; el enlace apunta a la API (`/api/files/<id>/raw?…`), firmado.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}/link`, { method: 'POST', headers: bearerHeaders(), cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE' } }, { status: 502 });
  }
  const body = await res.json().catch(() => ({ error: { code: 'BAD_RESPONSE' } }));
  return NextResponse.json(body, { status: res.status });
}
