import { NextResponse } from 'next/server';
import type { ImportApiConnection, ImportApiConnectionInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Guarda la conexión con la API de la cartera. Lo que se puede llamar lo valida el servidor. */
export async function PUT(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  const input = (await req.json().catch(() => ({}))) as ImportApiConnectionInput;
  const { status, body } = await apiCall<{ api: ImportApiConnection }>('/imports/portfolio/api-connection', {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(input),
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
