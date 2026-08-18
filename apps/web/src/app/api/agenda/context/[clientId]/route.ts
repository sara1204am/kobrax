import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Con qué se agenda una gestión para este deudor: sus casos agendables, sus teléfonos y sus
 * direcciones **en claro**.
 *
 * ⚠️ **Es una lectura que se audita** (`agenda_client_context/PII_REVEAL`), y por eso existe: es la
 * única puerta por la que quien cobra ve teléfonos y direcciones sin tener `client:pii:read`, y sólo
 * de un cliente con un caso suyo. Se pide al elegir el deudor, no antes: pedirla al abrir el
 * formulario dejaría un rastro de revelado por cada vez que alguien abre el alta y se arrepiente.
 */
export async function GET(_req: Request, { params }: { params: { clientId: string } }): Promise<NextResponse> {
  const { status, body } = await apiCall(`/agenda/clients/${params.clientId}/context`, {
    method: 'GET',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
