import { NextResponse } from 'next/server';
import type { MoraCreditListItem, RouteItem } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';

/**
 * Planificar el día: una ruta por cobrador, con sus créditos en mora más prioritarios.
 *
 * 🔴 **No hay endpoint de planificación en la API, y no hace falta uno todavía.** `POST
 * /routes/generate` ya crea la ruta de otro cobrador con los casos que se le pasen, y quien tiene
 * `route:assign` puede hacerlo por cualquiera. Lo que faltaba era **quién decide qué créditos entran**,
 * y eso se arma acá: los créditos en mora de cada cobrador (`GET /mora`, responsable), ordenados por
 * prioridad, cortados en el tope de paradas.
 *
 * 🔴 **Las N llamadas se hacen en el servidor**, no en el navegador: son dos por cobrador (leer sus
 * créditos y crear la ruta) y hacerlas desde acá deja al navegador con una sola. Mismo patrón que el
 * lote de Mora y que el guardado del cliente.
 *
 * ⚠️ **No es atómico** —la API no ofrece nada que lo sea—, así que si una ruta falla se sigue con
 * las demás y se devuelve fila por fila qué pasó. Cortar en la primera dejaría media planificación
 * hecha sin decir dónde quedó.
 *
 * Con `dryRun` no escribe nada: devuelve exactamente las mismas filas, que es lo que la pantalla
 * muestra para revisar antes de publicar.
 */

/** Tope duro de paradas por ruta. Ocho es lo que el negocio arma; treinta ya no es una jornada. */
const MAX_STOPS = 30;
const DEFAULT_STOPS = 8;
/** Cuántos cobradores por planificación. Es el techo de un equipo de sucursal, con margen. */
const MAX_COLLECTORS = 50;

interface PlanBody {
  plannedDate?: string;
  /** Modo automático: a cada uno, sus créditos en mora más urgentes hasta el tope. */
  collectorIds?: string[];
  stopsPerRoute?: number;
  /**
   * Modo elegido a mano: exactamente estos créditos para este cobrador.
   *
   * 🔴 Los créditos **no tienen por qué ser suyos**: un cobrador puede llevarse paradas de la cartera
   * de otro como ayuda de esa jornada, y el responsable del crédito **no cambia** (decisión de la
   * dueña, W11). La parada guarda el crédito; la cartera sigue diciendo de quién es la deuda.
   */
  assignments?: { collectorId: string; creditIds: string[] }[];
  dryRun?: boolean;
}

export interface PlanRow {
  collectorId: string;
  /** Créditos en mora que tiene, hasta el tope pedido. */
  stops: number;
  /** Ya tenía una ruta ese día: no se le crea otra (la base tampoco deja). */
  alreadyHasRoute?: boolean;
  /** Se creó de verdad (sólo fuera de `dryRun`). */
  created?: boolean;
  /** Por qué no se pudo, con el mensaje del servidor. */
  error?: string;
}

const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as PlanBody | null;
  const day = body?.plannedDate ?? '';
  // Una fila por cobrador. En el modo a mano trae sus créditos; en el automático los elige el handler.
  const asignaciones: { collectorId: string; creditIds?: string[] }[] = body?.assignments?.length
    ? body.assignments.filter((a) => a.collectorId && a.creditIds?.length)
    : [...new Set(body?.collectorIds ?? [])].map((collectorId) => ({ collectorId }));
  const collectorIds = asignaciones.map((a) => a.collectorId);

  if (!IS_DAY.test(day) || collectorIds.length === 0) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Falta la fecha o a quién planificarle' } },
      { status: 400 },
    );
  }
  if (collectorIds.length > MAX_COLLECTORS) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: `No más de ${MAX_COLLECTORS} cobradores por vez` } },
      { status: 400 },
    );
  }

  const stopsPerRoute = Math.min(MAX_STOPS, Math.max(1, Math.trunc(body?.stopsPerRoute ?? DEFAULT_STOPS)));

  /*
   * Quién ya tiene ruta ese día. Se pregunta UNA vez para todos: sin esto, cada uno de esos
   * cobradores se enteraría con un 422 al confirmar, y la revisión previa —que es para eso— habría
   * prometido rutas que no se iban a crear.
   */
  const existing = await apiCall<RouteItem[]>(`/routes?date=${day}&limit=100`, { method: 'GET', auth: true });
  const conRuta = new Set((existing.body.data ?? []).map((r) => r.collectorId));

  const rows: PlanRow[] = [];
  for (const a of asignaciones) {
    rows.push(
      await planOne(a.collectorId, day, stopsPerRoute, conRuta.has(a.collectorId), body?.dryRun === true, a.creditIds),
    );
  }

  return NextResponse.json({ rows, stopsPerRoute });
}

async function planOne(
  collectorId: string,
  plannedDate: string,
  stopsPerRoute: number,
  alreadyHasRoute: boolean,
  dryRun: boolean,
  /** Los créditos elegidos a mano. Sin esto, los elige el handler: los suyos, los más urgentes. */
  chosen?: string[],
): Promise<PlanRow> {
  let creditIds = chosen ?? [];

  if (!chosen) {
    // Los suyos, en mora, lo más urgente primero: es el mismo criterio con el que se mira Mora.
    const credits = await apiCall<MoraCreditListItem[]>(
      `/mora?assigneeId=${collectorId}&excludeRouted=${plannedDate}&sort=priority&dir=desc&limit=${stopsPerRoute}`,
      { method: 'GET', auth: true },
    );
    if (credits.status >= 400) {
      return { collectorId, stops: 0, error: credits.body.error?.message };
    }
    creditIds = (credits.body.data ?? []).map((c) => c.creditId);
  }
  const row: PlanRow = { collectorId, stops: creditIds.length, ...(alreadyHasRoute ? { alreadyHasRoute: true } : {}) };

  // Sin créditos no se arma una ruta vacía, y con ruta ya armada no se pisa la que hay.
  if (dryRun || alreadyHasRoute || creditIds.length === 0) return row;

  const created = await apiCall<RouteItem>('/routes/generate', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ collectorId, plannedDate, creditIds }),
  });
  if (created.status >= 400) return { ...row, error: created.body.error?.message };
  return { ...row, created: true };
}
