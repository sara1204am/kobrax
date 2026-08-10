import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders, sameOrigin } from '@/lib/bff';

interface Stored {
  url: string;
  hash: string;
  size: number;
  mimeType: string;
}

/**
 * Subir un archivo (foto de perfil, QR de cobro).
 *
 * El `FormData` se reenvía tal cual: el `content-type` con su *boundary* lo arma el navegador
 * y reescribirlo acá rompería el parseo del otro lado. Por eso no usa `apiCall`, que fuerza
 * `application/json`.
 *
 * El tamaño y los tipos permitidos los valida la API (8 MB): no se duplica la regla acá.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const res = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    headers: bearerHeaders(),
    body: await req.formData(),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as { data?: Stored; error?: unknown } | null;
  if (!res.ok || !body?.data) {
    return NextResponse.json({ error: body?.error ?? { code: 'UPLOAD', message: 'No se pudo subir el archivo' } }, { status: res.status });
  }

  return NextResponse.json(body.data);
}
