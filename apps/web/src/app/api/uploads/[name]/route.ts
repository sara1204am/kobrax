import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders } from '@/lib/bff';

/**
 * Servir un archivo subido.
 *
 * La API guarda la URL como `/api/uploads/<nombre>` — la misma ruta que este handler — así que
 * un `<img src={photoUrl}>` con lo que vino de la base cae acá y se sirve con el token de la
 * cookie. Sin este proxy habría que exponer la API al navegador, que es justo lo que el BFF
 * existe para evitar.
 */
export async function GET(_req: Request, { params }: { params: { name: string } }): Promise<Response> {
  const res = await fetch(`${API_BASE}/uploads/${encodeURIComponent(params.name)}`, {
    headers: bearerHeaders(),
    cache: 'no-store',
  });
  if (!res.ok || !res.body) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: res.status });

  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      // Privado: es la foto de una persona y va con su sesión, no en una CDN compartida.
      'cache-control': 'private, max-age=300',
    },
  });
}
