import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';

/** Tope de filas por lote. Es el tamaño de página más grande que ofrece la tabla. */
const MAX = 100;

interface BulkBody {
  action: 'assign' | 'clear' | 'priority';
  /** Ids de **casos** (lo que selecciona la tabla de Mora). */
  caseIds?: string[];
  /** `assign`: a quién. Vacío = al de menor carga (`auto`). */
  collectorId?: string;
  /** `clear`: cómo queda el préstamo. Mismo contrato que la acción de a uno. */
  mode?: string;
  date?: string;
  /** `priority`: la que se fija. `'auto'` = soltarla y devolverla al cálculo del trabajo diario. */
  priority?: string;
}

/**
 * Aplicar **la misma acción** a varias filas de Mora.
 *
 * 🔴 **Siempre con la acción elegida, nunca un «resolver» genérico.** Un botón que vaciara cuarenta
 * filas sin decir qué les hizo es exactamente donde se esconde cartera: el motivo es lo que después
 * deja contestar por qué desaparecieron cuarenta un martes. Por eso el cuerpo obliga a decir `action`
 * y, para poner al día, también **cómo** queda cada préstamo.
 *
 * Las N llamadas se hacen **acá**, no en el navegador: son una por fila y hacerlas desde el servidor
 * deja al navegador con una sola. Mismo patrón que el guardado del cliente (`opsRequests`).
 *
 * ⚠️ **No es atómico**: la API no expone un endpoint que lo sea. Si una falla, lo anterior ya se
 * aplicó — así que se sigue con las demás y se devuelve **cuántas entraron y cuántas no**. Cortar en
 * la primera dejaría el lote a medias sin decir dónde quedó, que es peor.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as BulkBody | null;
  const ids = body?.caseIds ?? [];
  if (!body || ids.length === 0) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Falta a qué aplicarlo' } }, { status: 400 });
  }
  if (ids.length > MAX) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: `No más de ${MAX} por vez` } }, { status: 400 });
  }

  let done = 0;
  let failed = 0;
  let message: string | undefined;

  for (const caseId of ids) {
    const res = await aplicarUna(caseId, body);

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

/** Una fila. Cada acción es la MISMA que la de a uno: no hay un camino en lote que haga otra cosa. */
function aplicarUna(caseId: string, body: BulkBody) {
  switch (body.action) {
    case 'assign':
      return apiCall(`/cases/${caseId}/assign`, {
        method: 'POST',
        auth: true,
        body: JSON.stringify(body.collectorId ? { collectorId: body.collectorId } : { auto: true }),
      });
    case 'priority':
      return apiCall(`/cases/${caseId}/priority`, {
        method: 'POST',
        auth: true,
        body: JSON.stringify(body.priority === 'auto' ? { auto: true } : { priority: body.priority }),
      });
    default:
      return ponerAlDia(caseId, body);
  }
}

/**
 * Poner al día en lote.
 *
 * El caso no sabe poner nada al día — eso es del **crédito**. Así que primero se lee el caso para
 * saber de qué préstamo se trata. Es una llamada de más por fila, y es el precio de que la tabla
 * seleccione casos (que es lo que lista) y la acción sea sobre créditos.
 */
async function ponerAlDia(caseId: string, body: BulkBody) {
  const kase = await apiCall<{ creditId?: string }>(`/cases/${caseId}`, { method: 'GET', auth: true });
  if (kase.status >= 400 || !kase.body.data?.creditId) return kase;

  return apiCall(`/credits/${kase.body.data.creditId}/arrears/clear`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ mode: body.mode ?? 'next_period', ...(body.date ? { date: body.date } : {}) }),
  });
}
