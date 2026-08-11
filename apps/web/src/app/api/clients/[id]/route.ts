import { NextResponse } from 'next/server';
import type { ClienteOps } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import { opsRequests } from '@/lib/client-ops';

interface Ctx {
  params: { id: string };
}

/**
 * Guardar la edición de un cliente.
 *
 * Recibe el **diff** del formulario (`ClienteOps` de `shared`) y lo aplica acá, no en el navegador:
 * son varias llamadas —cada sub-recurso tiene su endpoint— y hacerlas desde el servidor deja al
 * navegador con una sola, sin N idas y vueltas por el BFF.
 *
 * ⚠️ **No es atómico**: la API no expone un endpoint que lo sea. Si una llamada falla, lo anterior
 * ya se guardó. Por eso se corta en la primera y se devuelve **su** mensaje junto con cuántos
 * cambios alcanzaron a entrar: decir «no se pudo guardar» a secas sería mentira.
 */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const ops = (await req.json().catch(() => null)) as ClienteOps | null;
  if (!ops) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Falta el cuerpo' } }, { status: 400 });
  }

  const requests = opsRequests(params.id, ops);
  let applied = 0;
  for (const r of requests) {
    const { status, body } = await apiCall<unknown>(r.path, {
      method: r.method,
      auth: true,
      ...(r.body === undefined ? {} : { body: JSON.stringify(r.body) }),
    });
    if (status >= 400) {
      return NextResponse.json(
        { error: body.error ?? { code: 'SAVE_FAILED', message: 'No se pudo guardar' }, applied },
        { status },
      );
    }
    applied += 1;
  }

  return NextResponse.json({ ok: true, applied });
}

/**
 * Dar de baja al cliente.
 *
 * **No lo borra**: la API le pone `deletedAt` y lo deja `INACTIVE`, así que su historial —casos,
 * pagos, gestiones— sigue en pie. Y **rebota si tiene créditos activos** (`CLIENT_HAS_CREDITS`):
 * un deudor con plata en la calle no se archiva. La pantalla lo anticipa escondiendo el botón,
 * pero el freno de verdad es el del servidor.
 */
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { status, body } = await apiCall<null>(`/clients/${params.id}`, { method: 'DELETE', auth: true });
  if (status !== 204 && status !== 200) return apiError(status, body);

  return NextResponse.json({ ok: true });
}
