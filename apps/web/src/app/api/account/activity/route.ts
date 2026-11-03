import { NextResponse } from 'next/server';
import type { AccountActivityPage } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Una página más de la actividad de la cuenta. Sólo lee; `audit:read` lo valida la API. */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const qs = new URLSearchParams();
  for (const key of ['before', 'limit', 'entity', 'userId']) {
    const v = url.searchParams.get(key);
    if (v) qs.set(key, v);
  }
  const { status, body } = await apiCall<AccountActivityPage>(`/accounts/me/activity?${qs.toString()}`, { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
