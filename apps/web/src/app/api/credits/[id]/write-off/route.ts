import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Crédito no encontrado' } }, { status: 404 });

/** Castigar el crédito (`{ reason? }`). La API exige `credit:write` y alcance total. */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!isUuid(params.id)) return notFound();
  return proxyMutation<unknown>(req, `/credits/${params.id}/write-off`);
}

/** Revertir el castigo. */
export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!isUuid(params.id)) return notFound();
  return proxyMutation<unknown>(req, `/credits/${params.id}/write-off`, 'DELETE');
}
