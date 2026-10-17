import { NextResponse } from 'next/server';
import type { CursorPage, MemberActivityEvent } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** La siguiente página de la actividad de un miembro. Sólo lectura: no hay nada que validar de origen. */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const q = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['days', 'before', 'limit']) if (q.get(k)) qs.set(k, q.get(k)!);
  const { status, body } = await apiCall<CursorPage<MemberActivityEvent>>(`/users/${params.id}/activity/events?${qs}`, {
    method: 'GET',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
