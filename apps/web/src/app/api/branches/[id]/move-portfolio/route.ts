import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Cuántos créditos viajan por llamada a la API (su `ListCreditsQueryDto` topa en 100). */
const PAGE = 100;
/** Tope de seguridad: 100 páginas = 10 000 créditos por pasada; si hay más, se vuelve a pedir. */
const MAX_PAGES = 100;

/**
 * «Mover cartera» (ADR-0004): pasa los créditos de la oficina `:id` a `toBranchId`.
 *
 * Pagina `GET /credits?branchId=` para juntar los ids y llama a `POST /credits/reassign-office` por lote (cada lote es
 * atómico y auditado en la API). Devuelve cuántos se movieron; si un lote falla, para y devuelve el error con los que ya
 * pasaron, así se puede reintentar sin duplicar nada (lo ya movido ya no está en el origen).
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { toBranchId } = (await req.json().catch(() => ({}))) as { toBranchId?: string };
  if (!toBranchId) return NextResponse.json({ error: { code: 'VALIDATION', message: 'Falta la oficina de destino' } }, { status: 400 });

  let moved = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    // Siempre la página 1: lo que ya se movió sale del origen, así que la siguiente tanda vuelve a ser la primera.
    const page = await apiCall<{ id: string }[]>(`/credits?branchId=${encodeURIComponent(params.id)}&limit=${PAGE}&page=1`, {
      method: 'GET',
      auth: true,
    });
    if (page.status !== 200 || !page.body.data) return apiError(page.status, page.body);
    const ids = page.body.data.map((c) => c.id);
    if (ids.length === 0) break;

    const res = await apiCall<unknown>('/credits/reassign-office', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ creditIds: ids, toBranchId }),
    });
    if (res.status < 200 || res.status >= 300) return apiError(res.status, res.body);
    moved += ids.length;
    if (ids.length < PAGE) break;
  }
  return NextResponse.json({ moved });
}
