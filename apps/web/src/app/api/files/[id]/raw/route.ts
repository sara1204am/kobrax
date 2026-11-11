import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/bff';

/**
 * F14 · F4: el archivo por ENLACE FIRMADO, sin sesión. El enlace que da `POST /api/files/<id>/link` apunta acá (el navegador nunca habla con la API
 * directamente); este proxy lo reenvía tal cual a la API, que valida la firma (cuenta + archivo + vencimiento) y responde 404 si es mala o venció.
 * NO manda el token de la cookie: el enlace vale por sí mismo, y por eso la ruta está fuera del chequeo de sesión del `middleware`.
 */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const query = new URLSearchParams();
  for (const k of ['acc', 'exp', 'sig']) {
    const v = searchParams.get(k);
    if (v) query.set(k, v);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}/raw?${query.toString()}`, { cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE' } }, { status: 502 });
  }
  if (!res.ok || !res.body) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: res.status });
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
