import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders } from '@/lib/bff';

/**
 * F14 · F4: servir un archivo POR IDENTIFICADOR (`GET /api/files/<id>`), con la sesión de la cookie. La API decide con la política de lectura de
 * archivos (de qué cuelga el archivo y si la persona ve ese algo); un archivo ajeno y uno inexistente dan el mismo 404.
 *
 * Convive con `/api/uploads/<nombre>` (la ruta que guardan las columnas de URL y que usa el móvil): misma política, otra forma de pedirlo.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}`, { headers: bearerHeaders(), cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE' } }, { status: 502 });
  }
  if (!res.ok || !res.body) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: res.status });
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      // Privado: es el archivo de una persona y va con su sesión, no en una CDN compartida.
      'cache-control': 'private, max-age=300',
    },
  });
}
