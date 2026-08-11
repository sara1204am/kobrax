import { NextResponse } from 'next/server';
import { CreditOrigin, type CreditDetail, type NewCreditInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Alta de crédito desde la oficina.
 *
 * Dos cosas las pone el servidor y no el formulario:
 * - **`openCase: true`**, igual que el alta del móvil. Sin caso, el crédito queda cargado y **no le
 *   llega a nadie**: nadie lo cobra.
 * - **`origin: manual`**, que es lo que este crédito es. El candado de los campos financieros
 *   existe para el dato que viene de otra fuente, no para el que se carga acá.
 *
 * El cobrador asignado sí viene del formulario: en la oficina, quien carga el préstamo y quien lo
 * cobra no son la misma persona.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const input = (await req.json().catch(() => ({}))) as NewCreditInput;
  const { status, body } = await apiCall<CreditDetail>('/credits', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ ...input, openCase: true, origin: CreditOrigin.MANUAL }),
  });
  if ((status !== 200 && status !== 201) || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
