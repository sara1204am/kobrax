import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Un catálogo del tenant (medios de pago, bancos, motivos, plantillas de WhatsApp…).
 *
 * El `GET` va sin `sameOrigin` porque no tiene efecto. Existe para que el alta de una gestión
 * pueda ofrecer los medios de pago que esta empresa configuró, sin que el navegador tenga que
 * hablarle a la API directamente — que es lo que el BFF existe para evitar.
 */
export async function GET(_req: Request, { params }: { params: { type: string } }): Promise<NextResponse> {
  const { status, body } = await apiCall<{ code: string; label: string }[]>(
    `/catalogs/${encodeURIComponent(params.type)}`,
    { method: 'GET', auth: true },
  );
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}

/** Alta de un ítem (`catalog:write` lo valida la API). Lo usa el editor de plantillas de Cuenta. */
export async function POST(req: Request, { params }: { params: { type: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<{ id: string }>(`/catalogs/${encodeURIComponent(params.type)}`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  if (status >= 300 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}
