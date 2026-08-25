import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders } from '@/lib/bff';

/** El legajo del cliente en PDF. Mismo patrón que `api/uploads/[name]`: reenvía el archivo tal cual. */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/clients/${params.id}/pdf`, { headers: bearerHeaders(), cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE' } }, { status: 502 });
  }
  if (!res.ok || !res.body) return NextResponse.json({ error: { code: 'PDF_FAILED' } }, { status: res.status });

  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'private, no-store',
    },
  });
}
