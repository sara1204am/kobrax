import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { isUuid } from '@/lib/uuid';

/** Tope de filas por lote. Es el tamaño de página más grande que ofrece la tabla. */
const MAX = 100;

interface BulkBody {
  action: 'assign' | 'clear' | 'priority';
  /** Ids de **créditos** (lo que selecciona la tabla de Mora). */
  creditIds?: string[];
  /** `assign`: el nuevo responsable. Obligatorio. */
  userId?: string;
  /** `clear`: cómo queda el préstamo. Mismo contrato que la acción de a uno. */
  mode?: string;
  date?: string;
  /** `priority`: la que se fija. `'auto'` = soltarla y devolverla al cálculo del trabajo diario. */
  priority?: string;
}

/**
 * Aplicar **la misma acción** a varios créditos de Mora (F4/08: por `creditIds`, sin casos).
 *
 * 🔴 **Siempre con la acción elegida, nunca un «resolver» genérico.** Un botón que vaciara cuarenta filas sin
 * decir qué les hizo es donde se esconde cartera.
 *
 * - `assign` es **una sola llamada** (`POST /assignments/bulk`): atómica por crédito, y la API devuelve cuáles
 *   saltó y por qué.
 * - `priority` y `clear` son una llamada por crédito, hechas **acá** (el navegador hace una sola).
 *
 * ⚠️ No son atómicas en lote: si una falla se sigue con las demás y se devuelve **cuántas entraron y cuántas no**.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as BulkBody | null;
  const ids = body?.creditIds ?? [];
  if (!body || ids.length === 0 || !ids.every(isUuid)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Falta a qué aplicarlo' } }, { status: 400 });
  }
  if (ids.length > MAX) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: `No más de ${MAX} por vez` } }, { status: 400 });
  }

  if (body.action === 'assign') return reasignar(ids, body);

  let done = 0;
  let failed = 0;
  let message: string | undefined;

  for (const creditId of ids) {
    const res = await aplicarUna(creditId, body);
    if (res.status >= 400) {
      failed += 1;
      // El primer motivo alcanza: cuarenta iguales no explican más que uno.
      message ??= res.body.error?.message;
    } else {
      done += 1;
    }
  }

  return NextResponse.json({ done, failed, message });
}

/** Reasignar el responsable de todos de una vez. `skipped` trae el motivo de cada uno que no cambió. */
async function reasignar(creditIds: string[], body: BulkBody): Promise<NextResponse> {
  if (!body.userId || !isUuid(body.userId)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Elegí al cobrador' } }, { status: 400 });
  }
  const res = await apiCall<{ changed: number; skipped: { creditId: string; reason: string }[] }>('/assignments/bulk', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ creditIds, userId: body.userId }),
  });
  if (res.status >= 400 || !res.body.data) {
    return NextResponse.json({ error: res.body.error ?? { code: 'BAD_REQUEST', message: 'No se pudo asignar' } }, { status: res.status || 400 });
  }
  const { changed, skipped } = res.body.data;
  // `message` lleva el código del primer motivo: la pantalla lo traduce.
  return NextResponse.json({ done: changed, failed: skipped.length, message: skipped[0]?.reason });
}

/** Un crédito. Cada acción es la MISMA que la de a uno: no hay un camino en lote que haga otra cosa. */
function aplicarUna(creditId: string, body: BulkBody) {
  if (body.action === 'priority') {
    return apiCall(`/mora/${creditId}/priority`, {
      method: 'PATCH',
      auth: true,
      body: JSON.stringify({ priority: body.priority === 'auto' || !body.priority ? null : body.priority }),
    });
  }
  return apiCall(`/credits/${creditId}/arrears/clear`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ mode: body.mode ?? 'next_period', ...(body.date ? { date: body.date } : {}) }),
  });
}
