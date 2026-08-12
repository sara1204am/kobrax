import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Registrar una gestión sobre el caso (`case:write`).
 *
 * Con `promise` adentro, la API además crea un `agenda_item` de tipo `PROMISE_TO_PAY`: **las
 * promesas de pago no tienen tabla propia**, son ítems de agenda. Por eso registrar una gestión
 * puede cambiar lo que se ve en la agenda.
 */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<{ id: string; type: string; createdAt: string }>(req, `/cases/${params.id}/activities`);
}
