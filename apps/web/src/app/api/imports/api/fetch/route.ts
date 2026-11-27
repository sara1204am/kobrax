import { NextResponse } from 'next/server';
import type { ImportApiDocument } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Trae la cartera de la API configurada. La respuesta queda guardada en el servidor; acá sólo llega su id. */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const { status, body } = await apiCall<ImportApiDocument>('/imports/portfolio/api-fetch', { method: 'POST', auth: true });
  if (status >= 300 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
