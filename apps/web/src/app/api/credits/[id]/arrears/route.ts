import { NextResponse } from 'next/server';
import type { CreditDetail } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * Marcar un préstamo en mora, a mano — y **abrir su caso en el acto**.
 *
 * Es para quien presta sin cronograma y sabe que le deben sin mirar una fecha. El servidor guarda
 * desde cuándo corre (no cuántos días), así el número envejece solo, y abre el caso sin esperar al
 * trabajo diario: quien aprieta este botón quiere ver el crédito en Mora ahora.
 *
 * `POST` con `{ days? }`; `DELETE` es ponerlo al día y vive en `./clear`, porque lleva cuerpo —
 * hay que decir **cómo** se pone al día, y un `DELETE` con cuerpo es una de esas cosas que a veces
 * el proxy de alguien borra en el camino.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = (await req.json().catch(() => ({}))) as { days?: number };
  const { status, body } = await apiCall<CreditDetail>(`/credits/${params.id}/arrears`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(dto),
  });
  if (status !== 200 && status !== 201) return apiError(status, body);

  return NextResponse.json(body.data);
}
