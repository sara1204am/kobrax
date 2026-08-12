import { NextResponse } from 'next/server';
import type { ColumnsPayload, PortfolioSummary } from '@kobrax/shared';
import { API_BASE, bearerHeaders, sameOrigin, type ApiEnvelope } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Correr el import: sube el archivo a `POST /imports/portfolio`.
 *
 * 🔴 **`dryRun` y `columnsOnly` no viajan por el mismo lado.** `dryRun` es un **campo del
 * multipart** (`@Body('dryRun')`) y por eso viaja adentro del `FormData`, invisible acá;
 * `columnsOnly` es **query param** (`@Query`). Mandar `dryRun` por query haría que el POST
 * aplique la importación de verdad creyendo que previsualiza.
 *
 * El `FormData` se reenvía tal cual (mismo patrón que `account/upload`): el `content-type` con
 * su boundary lo arma el navegador y `apiCall` lo pisaría con `application/json`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const columnsOnly = new URL(req.url).searchParams.get('columnsOnly') === 'true';

  // `fetch` crudo y no `apiCall`, así que el try/catch va a mano: sin él, la API caída tira una
  // excepción en el handler — justo lo que el arreglo de W1 vino a sacar.
  // ponytail: `await req.formData()` bufferea los 15 MB en el server de Next. Es el patrón que ya
  // usa `account/upload` y a este volumen no duele; el día que duela, se reenvía `req.body` como
  // stream con `duplex: 'half'`.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/imports/portfolio${columnsOnly ? '?columnsOnly=true' : ''}`, {
      method: 'POST',
      headers: bearerHeaders(),
      body: await req.formData(),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_UNREACHABLE', message: 'No pudimos conectar con el servidor' } },
      { status: 502 },
    );
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<PortfolioSummary | ColumnsPayload> | null;
  if (!res.ok || !body?.data) return apiError(res.status, (body ?? {}) as ApiEnvelope<unknown>);

  return NextResponse.json(body.data);
}
