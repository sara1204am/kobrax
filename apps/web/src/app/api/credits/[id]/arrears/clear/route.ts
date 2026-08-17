import { NextResponse } from 'next/server';
import type { CreditDetail } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * Poner al día. **Mueve la fecha de vencimiento y cierra el caso** — no borra el síntoma.
 *
 * Los tres modos los decide la pantalla y los valida el servidor: avanzar un período, poner la fecha
 * que se acordó, o dejar el préstamo sin vencimiento. Una fecha pasada la rechaza con
 * `ARREARS_DATE_PAST`: dejaría el crédito en mora igual y el trabajo diario le reabriría el caso
 * esta misma noche.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = (await req.json().catch(() => ({}))) as { mode?: string; date?: string };
  const { status, body } = await apiCall<CreditDetail>(`/credits/${params.id}/arrears/clear`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(dto),
  });
  if (status !== 200 && status !== 201) return apiError(status, body);

  return NextResponse.json(body.data);
}
