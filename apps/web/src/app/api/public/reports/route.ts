import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Formulario público de reportes (`/reportar`, `/eliminar-cuenta`) → `POST /public/reports`. Sin sesión: lo protegen el límite de
 * peticiones de la API (por IP real, que `apiCall` le reenvía), la trampa `website` y el tope por correo. Se nombran los campos uno por
 * uno: lo demás se descarta.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { status, body } = await apiCall<{ reference: string }>('/public/reports', {
    method: 'POST',
    body: JSON.stringify({
      type: p?.type,
      contactEmail: p?.contactEmail,
      contactName: p?.contactName || undefined,
      reportedSubject: p?.reportedSubject || undefined,
      description: p?.description,
      website: p?.website || undefined,
    }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { status: 201 });
}
