import { NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import { platformCall } from '@/lib/platform-bff';
import { isUuid } from '@/lib/uuid';

/** Suspende o reactiva una cuenta, con motivo → `POST /platform/accounts/:id/status`. Solo `SUSPENDED` o `ACTIVE`. */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontrado' } }, { status: 404 });
  const p = (await req.json().catch(() => null)) as { status?: string; reason?: string } | null;
  const { status, body } = await platformCall<unknown>(`/platform/accounts/${params.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: p?.status, reason: p?.reason }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
