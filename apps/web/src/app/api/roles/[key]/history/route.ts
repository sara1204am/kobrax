import { NextResponse } from 'next/server';
import type { RoleHistoryPage } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** F14 · F7: una página más del historial de un rol (`GET /roles/:key/history`). Sólo lee: va sin `sameOrigin`. */
export async function GET(req: Request, { params }: { params: { key: string } }): Promise<NextResponse> {
  const url = new URL(req.url);
  const qs = new URLSearchParams();
  const cursor = url.searchParams.get('cursor');
  const limit = url.searchParams.get('limit');
  if (cursor) qs.set('cursor', cursor);
  if (limit) qs.set('limit', limit);
  const { status, body } = await apiCall<RoleHistoryPage>(`/roles/${encodeURIComponent(params.key)}/history${qs.size ? `?${qs}` : ''}`, { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
