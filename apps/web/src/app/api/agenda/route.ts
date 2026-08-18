import { NextResponse } from 'next/server';
import type { AgendaListItem } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Agendar una gestión desde el panel.
 *
 * El cuerpo va tal cual: qué exige cada tipo lo decide `validateAgendaDetails` en el servidor —la
 * misma función que valida lo que manda el teléfono—. Re-validarlo acá sería una segunda copia de
 * la regla que se separa la primera vez que cambia una.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = await req.json().catch(() => ({}));
  const { status, body } = await apiCall<AgendaListItem>('/agenda', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(dto),
  });
  if (status !== 200 && status !== 201) return apiError(status, body);

  return NextResponse.json(body.data);
}
