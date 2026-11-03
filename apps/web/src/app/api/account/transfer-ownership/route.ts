import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Pasar la propiedad de la cuenta a otro administrador. El cuerpo lleva la contraseña y el código: se reenvían tal
 * cual y no se registran acá. Que el pedido sea del dueño, el destinatario y el segundo factor los valida la API.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<{ ok: true }>('/accounts/me/transfer-ownership', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  if (status >= 300 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
