import { NextResponse } from 'next/server';
import type { ArrearCategory } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Las categorías de mora (A / B / C…) de la cuenta (F4/08 · D1-b). Requiere `collection:read`; la API lo valida.
 */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<ArrearCategory[]>('/arrear-categories', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json({ data: body.data });
}

/**
 * Reemplaza el juego completo. El cuerpo va tal cual: los rangos (desde 1, sin huecos ni solapes, sólo la última
 * sin tope) los valida `validateArrearCategories` en el servidor y rebotan con 400 `ARREAR_CATEGORIES_INVALID`.
 * Requiere `account:write`.
 */
export async function PUT(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = await req.json().catch(() => ({}));
  const { status, body } = await apiCall<ArrearCategory[]>('/arrear-categories', {
    method: 'PUT',
    auth: true,
    body: JSON.stringify(dto),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}
