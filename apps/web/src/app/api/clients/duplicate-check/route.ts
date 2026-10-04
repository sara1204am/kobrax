import { NextResponse } from 'next/server';
import type { ClientDuplicateCheck, ClientDuplicateCheckInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * ¿Ya hay alguien con este carnet, o que se llame igual? Lo pregunta el modal «Nuevo cliente»
 * mientras se escribe. `POST` para que el carnet no viaje en la URL.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const input = (await req.json().catch(() => ({}))) as ClientDuplicateCheckInput;
  const { status, body } = await apiCall<ClientDuplicateCheck>('/clients/duplicate-check', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(input),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
