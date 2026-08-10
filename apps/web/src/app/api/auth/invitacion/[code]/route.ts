import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Datos de una invitación pendiente → `GET /auth/invitation/:code`, para pintarla antes de
 * aceptarla. Público: la guarda es tener el código (y su rate limit de 10/min por IP en la API).
 *
 * Sin `sameOrigin()`: es una lectura, y el chequeo existe contra CSRF — que no aplica a algo que
 * no muta nada. Ponerlo además rompería abrir el link de la invitación desde el correo.
 */
export async function GET(_req: Request, { params }: { params: { code: string } }): Promise<NextResponse> {
  const { status, body } = await apiCall<{
    email: string;
    firstName: string | null;
    businessName: string | null;
  }>(`/auth/invitation/${encodeURIComponent(params.code)}`);

  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
