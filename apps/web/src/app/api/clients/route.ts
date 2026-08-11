import { NextResponse } from 'next/server';
import type { ClientDetail, NewClientInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Alta de cliente. Una sola llamada: la API crea al cliente, sus teléfonos, sus direcciones y sus
 * garantes **en la misma transacción**, así que un fallo no deja un cliente a medio cargar.
 *
 * No manda `id`. El que propone el id es el móvil, para que un alta encolada sin señal se pueda
 * reintentar sin crear dos deudores; el panel no tiene cola y el server genera el suyo.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const input = (await req.json().catch(() => ({}))) as NewClientInput;
  const { status, body } = await apiCall<ClientDetail>('/clients', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(input),
  });
  if (status !== 200 && status !== 201) return apiError(status, body);
  if (!body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
