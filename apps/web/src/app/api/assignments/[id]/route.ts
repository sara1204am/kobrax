import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

/** Quitar un reemplazo temporal o una ayuda (el responsable no se quita: se reasigna). `assignment:write`. */
export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Asignación no encontrada' } }, { status: 404 });
  }
  return proxyMutation<unknown>(req, `/assignments/${params.id}`, 'DELETE');
}
