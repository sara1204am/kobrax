import { NextResponse } from 'next/server';
import { CreditOrigin, type CreditDetail, type NewCreditInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Los créditos de un deudor, para elegir sobre cuál se registra un pago (`?clientId=`).
 *
 * Sólo viaja `clientId` (un uuid que el DTO valida) y un tope de filas: un parámetro de más sería un
 * 400 y el selector quedaría vacío.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const clientId = new URL(req.url).searchParams.get('clientId') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'clientId inválido' } }, { status: 400 });
  }
  const { status, body } = await apiCall<CreditDetail[]>(`/credits?clientId=${clientId}&limit=50`, { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}

/**
 * Alta de crédito desde la oficina.
 *
 * Una cosa la pone el servidor y no el formulario:
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
    body: JSON.stringify({ ...input, origin: CreditOrigin.MANUAL }),
  });
  if ((status !== 200 && status !== 201) || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
