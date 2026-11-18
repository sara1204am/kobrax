import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Re-aceptación (cambió algo material) → `POST /legal/acceptances`. Se nombran los dos campos uno por uno: lo que no se nombre
 * se pierde en silencio. Viajan ids de versión, nunca un texto ni un hash; el servidor revalida que sigan siendo los vigentes.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  // Un cuerpo `null` o raro no debe tumbar el handler: se lee con `?.` y la API responde 422 si falta algo.
  const parsed = (await req.json().catch(() => null)) as { termsVersionId?: string; privacyVersionId?: string } | null;
  const termsVersionId = parsed?.termsVersionId;
  const privacyVersionId = parsed?.privacyVersionId;
  const { status, body } = await apiCall<unknown>('/legal/acceptances', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ termsVersionId, privacyVersionId }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
