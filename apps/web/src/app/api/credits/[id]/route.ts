import { NextResponse } from 'next/server';
import type { CreditDetail, UpdateCreditPatch } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * Editar un crédito: capital, tasa, cuota, frecuencia, próxima fecha, estado, código, tipo,
 * responsable y notas — todo lo que acepta `UpdateCreditDto`.
 *
 * Número de cuotas, moneda y fecha de desembolso **no entran acá**: cambiarlos sin regenerar el
 * cronograma deja una tabla de cuotas que no cierra con el préstamo. Eso es una reestructura.
 *
 * Si el crédito vino de un archivo o de otro core, la API rechaza el cambio con `CREDIT_LOCKED`.
 * La pantalla ya lo anticipa deshabilitando los campos, pero el freno de verdad es el del servidor.
 */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const patch = (await req.json().catch(() => ({}))) as UpdateCreditPatch;
  const { status, body } = await apiCall<CreditDetail>(`/credits/${params.id}`, {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(patch),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
