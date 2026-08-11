import { NextResponse } from 'next/server';
import type { ClientDetail } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * Ver la PII del cliente en claro.
 *
 * **Es la única lectura del módulo con handler propio**, y es a propósito: `?reveal=true` deja un
 * registro `client/PII_REVEAL` en la auditoría, así que no es una lectura de pantalla sino una
 * **acción disparada por un click**. Si la ficha revelara sola al abrirse, la auditoría se llenaría
 * de ruido y sería inútil justo el día que haya que leerla.
 *
 * Va por `POST` por lo mismo: tiene efecto. Un `GET` con efecto se cachea, se pre-carga y se
 * dispara desde un `<img>` sin que nadie lo haya pedido.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { status, body } = await apiCall<ClientDetail>(`/clients/${params.id}?reveal=true`, {
    method: 'GET',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
