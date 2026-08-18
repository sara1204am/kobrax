import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Cargar una dirección que el deudor no tenía, desde el alta de una gestión.
 *
 * 🔴 **No pasa por `/clients/:id/locations`, y es a propósito**: la API expone esta puerta bajo
 * `AGENDA_WRITE` y no `CLIENT_WRITE`. Quien cobra no administra clientes, pero sí necesita cargar el
 * domicilio al que va a ir — si no, una visita a una dirección que nadie tipeó todavía es imposible
 * de agendar, que es exactamente el caso que trae a alguien acá.
 */
export async function POST(req: Request, { params }: { params: { clientId: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = await req.json().catch(() => ({}));
  const { status, body } = await apiCall(`/agenda/clients/${params.clientId}/locations`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(dto),
  });
  if (status !== 200 && status !== 201) return apiError(status, body);

  return NextResponse.json(body.data);
}
