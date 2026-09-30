import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders } from '@/lib/bff';
import { isUuid } from '@/lib/uuid';

/**
 * El documento de una importación, tal como se subió. Mismo patrón que `api/clients/[id]/pdf`:
 * reenvía el archivo con el Bearer de la cookie. `?download=1` lo baja; sin eso se abre en el
 * navegador — la API decide la `content-disposition` y acá se respeta.
 */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  // Un id inventado no viaja: la API lo rechazaría igual, pero con un 400 que acá no sirve de nada.
  if (!isUuid(params.id)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  const download = new URL(req.url).searchParams.get('download') === '1' ? '?download=1' : '';

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/imports/portfolio/runs/${params.id}/file${download}`, {
      headers: bearerHeaders(),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE' } }, { status: 502 });
  }
  if (!res.ok || !res.body) return NextResponse.json({ error: { code: 'FILE_FAILED' } }, { status: res.status });

  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'private, no-store',
    },
  });
}
