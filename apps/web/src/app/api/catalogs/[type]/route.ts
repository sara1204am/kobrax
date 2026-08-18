import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Un catálogo del tenant (medios de pago, bancos, motivos…).
 *
 * Sólo lectura y por eso sin `sameOrigin`: es un `GET` sin efecto. Existe para que el alta de una
 * gestión pueda ofrecer los medios de pago que esta empresa configuró, sin que el navegador tenga
 * que hablarle a la API directamente — que es lo que el BFF existe para evitar.
 */
export async function GET(_req: Request, { params }: { params: { type: string } }): Promise<NextResponse> {
  const { status, body } = await apiCall<{ code: string; label: string }[]>(
    `/catalogs/${encodeURIComponent(params.type)}`,
    { method: 'GET', auth: true },
  );
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}
