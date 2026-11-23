import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Crédito no encontrado' } }, { status: 404 });

/** Exonerar interés moratorio de una cuota (`{ installmentNumber, amount, reason }`). La API exige `payment:waive_late` y que el crédito esté en alcance. */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!isUuid(params.id)) return notFound();
  return proxyMutation<unknown>(req, `/credits/${params.id}/late-interest/waivers`);
}
