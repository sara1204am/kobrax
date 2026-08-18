import { NextResponse } from 'next/server';
import type { ClientDetail, NewClientInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import type { PortfolioRow } from '@/lib/portfolio';

/**
 * Buscar un deudor desde el navegador.
 *
 * 🔴 **La cartera no pasaba por acá**: la lista se arma en un server component, así que hasta ahora
 * ningún `GET /clients` existía en el BFF y el buscador del alta de gestión no encontraba a nadie.
 *
 * Devuelve la vista `portfolio` —la misma que la lista— y no el detalle: trae el nombre, el carnet
 * **enmascarado** y la mora en una consulta, sin revelar PII. Los datos en claro se piden después,
 * con el cliente ya elegido, por `/api/agenda/context/:id`, que sí deja rastro de auditoría.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams({ view: 'portfolio', limit: src.get('limit') ?? '8' });
  const q = src.get('q')?.trim();
  if (q) qs.set('q', q);

  const { status, body } = await apiCall<PortfolioRow[]>(`/clients?${qs}`, { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}

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
