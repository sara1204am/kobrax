import { NextResponse } from 'next/server';
import type { MeInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';

export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) {
    return NextResponse.json({ error: body.error ?? { code: 'AUTH_003', message: 'No autenticado' } }, { status: status >= 400 ? status : 401 });
  }
  return NextResponse.json(body.data);
}
