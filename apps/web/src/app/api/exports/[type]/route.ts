import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders } from '@/lib/bff';

/** Los únicos tipos que la API expone bajo `/exports/*`. Cierra la ruta a que `type` reenvíe cualquier cosa. */
const ALLOWED = new Set(['clients', 'locations', 'cases', 'agenda', 'backup']);

/**
 * Proxy del BFF para las descargas de `/exportar`. Igual que `api/uploads/[name]`: el navegador
 * navega hasta acá con la cookie de sesión, este handler adjunta el Bearer y reenvía el archivo
 * tal cual llega, incluido el `Content-Disposition` que hace que el navegador lo baje.
 */
export async function GET(_req: Request, { params }: { params: { type: string } }): Promise<Response> {
  if (!ALLOWED.has(params.type)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/exports/${params.type}`, { headers: bearerHeaders(), cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE' } }, { status: 502 });
  }
  if (!res.ok || !res.body) return NextResponse.json({ error: { code: 'EXPORT_FAILED' } }, { status: res.status });

  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'private, no-store',
    },
  });
}
