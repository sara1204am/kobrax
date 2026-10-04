import { NextResponse } from 'next/server';
import type { CreditDetail, UpdateCreditPatch } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * Editar un crédito: redefinir sus condiciones y el estado al registrar (F4/06 · Fase 3), el
 * próximo cobro, estado, código, tipo, responsable y notas — todo lo que acepta `UpdateCreditDto`.
 *
 * Las reglas son de la API: con pagos registrados no se redefine (`CREDIT_HAS_PAYMENTS`), y si el
 * crédito vino de un archivo o de otro core, lo financiero se rechaza con `CREDIT_LOCKED`. La
 * pantalla lo anticipa sin ofrecer esos campos, pero el freno de verdad es el del servidor.
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
