import { NextResponse } from 'next/server';
import type { CaseListItem } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * Subir o bajar la prioridad a mano, o devolverla a la automática.
 *
 * 🔴 **Fijarla es lo que hace que dure.** El trabajo diario recalcula la prioridad de cada cobranza
 * abierta desde el saldo, la mora y el riesgo; sin la marca, subirle la prioridad a un deudor con dos
 * días de atraso duraba hasta la noche. Con ella, el job saltea esa cobranza — y `{ auto: true }` la
 * suelta para que vuelva a calcularla.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = (await req.json().catch(() => ({}))) as { priority?: string; auto?: boolean };
  const { status, body } = await apiCall<CaseListItem>(`/cases/${params.id}/priority`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(dto),
  });
  if (status !== 200 && status !== 201) return apiError(status, body);

  return NextResponse.json(body.data);
}
