import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string; action: string };
}

/** Las únicas acciones del administrador sobre un acceso de soporte. Cualquier otra cosa en la URL no llega a la API. */
const ACTIONS = new Set(['grant', 'deny', 'revoke']);

/**
 * F14 · F5 (H-11): aceptar, rechazar o cortar un acceso de soporte de la plataforma a esta cuenta. Muta, así que valida el origen (CSRF); la API exige
 * `support:consent` y que el acceso sea de ESTA cuenta.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  if (!ACTIONS.has(params.action)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  const { status, body } = await apiCall<unknown>(`/support-access/${encodeURIComponent(params.id)}/${params.action}`, { method: 'POST', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
