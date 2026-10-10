import { NextResponse } from 'next/server';
import type { AgendaListItem } from '@kobrax/shared';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Gestión no encontrada' } }, { status: 404 });

/**
 * Editar una gestión pendiente: tipo, sus datos, hora y observaciones. Sin día ni deudor (mover el día es
 * reagendar). **Solo quien la creó** (`agenda:write` + autoría): la API responde 403 a cualquier otro, también
 * al administrador; acá no se repite esa regla.
 */
export function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> | NextResponse {
  if (!isUuid(params.id)) return notFound();
  return proxyMutation<AgendaListItem>(req, `/agenda/${params.id}`, 'PATCH');
}

/** Eliminar una gestión pendiente cargada por error. Misma regla de autoría que editar. */
export function DELETE(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> | NextResponse {
  if (!isUuid(params.id)) return notFound();
  return proxyMutation<AgendaListItem>(req, `/agenda/${params.id}`, 'DELETE');
}
