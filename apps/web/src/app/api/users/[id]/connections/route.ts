import { NextResponse } from 'next/server';
import type { CursorPage, MemberConnection } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** La siguiente página de los accesos de un miembro. Sólo lectura. */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const q = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['before', 'limit']) if (q.get(k)) qs.set(k, q.get(k)!);
  const { status, body } = await apiCall<CursorPage<MemberConnection>>(`/users/${params.id}/connections?${qs}`, {
    method: 'GET',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
