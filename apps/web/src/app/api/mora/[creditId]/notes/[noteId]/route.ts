import { NextResponse } from 'next/server';
import type { CreditNote } from '@kobrax/shared';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

const notFound = (): NextResponse => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Nota no encontrada' } }, { status: 404 });

/**
 * 🔴 Los dos ids viajan dentro del path hacia la API, así que se validan como uuid **antes** de armar la URL: un
 * valor como `../cases` apuntaría la mutación a otro endpoint. Quién puede cambiar qué (el texto es de quien la
 * escribió o de quien reparte cartera; mover y pintar, de cualquiera que escriba) lo decide la API.
 */
type Ctx = { params: { creditId: string; noteId: string } };

/** Editar un post-it: texto, tipo, color, lugar, tamaño o «al frente». */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!isUuid(params.creditId) || !isUuid(params.noteId)) return notFound();
  return proxyMutation<CreditNote>(req, `/mora/${params.creditId}/notes/${params.noteId}`, 'PATCH');
}

/** Borrar un post-it (borrado lógico en la API). */
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!isUuid(params.creditId) || !isUuid(params.noteId)) return notFound();
  return proxyMutation<{ id: string }>(req, `/mora/${params.creditId}/notes/${params.noteId}`, 'DELETE');
}
