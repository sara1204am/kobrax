import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import { LEGAL_LOCALE } from '@/lib/legal';

/** Lo que se acepta como slug y como versión: lista cerrada de caracteres, para que nada del cliente arme una ruta arbitraria hacia la API. */
const SLUG = /^[a-z-]{2,30}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,30}$/;

/**
 * Un documento legal → `GET /legal/documents/:slug/current` o, con `?version=`, esa versión exacta.
 *
 * Público a propósito: se tiene que poder leer antes de aceptar. **El modal del registro pide la versión exacta que va a aceptar**
 * (la que devolvió `signup-documents`), así que lo que se lee es lo mismo que se acepta.
 */
export async function GET(req: Request, { params }: { params: { slug: string } }): Promise<NextResponse> {
  const { slug } = params;
  const version = new URL(req.url).searchParams.get('version');
  if (!SLUG.test(slug) || (version !== null && !VERSION.test(version))) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Documento no válido' } }, { status: 400 });
  }
  const path = version
    ? `/legal/documents/${slug}/versions/${encodeURIComponent(version)}`
    : `/legal/documents/${slug}/current`;
  const { status, body } = await apiCall<unknown>(`${path}?locale=${LEGAL_LOCALE}`);
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}
