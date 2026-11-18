import { NextResponse } from 'next/server';
import {
  mergeGuideState,
  parseGuideState,
  sanitizeGuidePatch,
  type GuideState,
} from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Estado de las guías de la propia persona (F15 · P8). Sin permiso: cada quien solo toca su fila (la clave sale de la sesión
 * en la API). El navegador manda un PARCHE («cerré la tarjeta») y el BFF lo mezcla con lo guardado, para que dos pestañas que
 * marcan cosas distintas no se borren entre sí.
 */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<GuideState>('/users/me/guides', {
    method: 'GET',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json({ data: parseGuideState(body.data) });
}

export async function PATCH(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json(
      { error: { code: 'CSRF', message: 'Origen no permitido' } },
      { status: 403 },
    );
  }
  // Solo se aceptan los campos conocidos y bien tipados; un cuerpo raro no tumba el handler ni corrompe lo guardado.
  const patch = sanitizeGuidePatch(await req.json().catch(() => null));
  const current = await apiCall<GuideState>('/users/me/guides', { method: 'GET', auth: true });
  if (current.status !== 200 || !current.body.data) return apiError(current.status, current.body);

  const merged = mergeGuideState(parseGuideState(current.body.data), patch);
  const { status, body } = await apiCall<GuideState>('/users/me/guides', {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(merged),
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json({ data: parseGuideState(body.data) });
}
